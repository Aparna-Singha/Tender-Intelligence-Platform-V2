import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
  type MessageEvent,
} from "@nestjs/common";
import type {
  AssessmentFilter,
  AssessmentReviewRequest,
  CreateCompanyCitationRequest,
  CreateEvidenceFactRequest,
  EvidenceFactReviewRequest,
  LinkAssessmentEvidenceRequest,
} from "@tender/contracts";
import type { Prisma, PrismaClient } from "@tender/database";
import {
  canHumanFinaliseVerified,
  EVIDENCE_COMPARISON_POLICY_VERSION,
  EVIDENCE_NORMALISATION_POLICY_VERSION,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { Observable, concat, from, interval, map, takeUntil } from "rxjs";
import { JOB_QUEUE, PRISMA_CLIENT } from "../infrastructure.tokens.js";

@Injectable()
export class EligibilityService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
  ) {}

  public async start(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    clientKey: string,
    requestId: string,
    triggerType: "USER" | "RETRY" = "USER",
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      include: { activeEarlyRiskRun: true, activeExtractionRun: true },
      where: {
        id: versionId,
        tender: {
          currentVersionId: versionId,
          deletedAt: null,
          id: tenderId,
          organisationId,
        },
      },
    });
    if (version === null) throw new NotFoundException();
    const extraction = version.activeExtractionRun;
    const risk = version.activeEarlyRiskRun;
    if (extraction?.status !== "COMPLETE" || extraction.invalidatedAt !== null)
      throw new UnprocessableEntityException(
        "A current completed extraction is required",
      );
    if (
      risk?.status !== "COMPLETE" ||
      risk.invalidatedAt !== null ||
      risk.extractionRunId !== extraction.id
    )
      throw new UnprocessableEntityException(
        "A current completed EARLY risk analysis is required",
      );
    const decision = await this.database.earlyPursuitDecision.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        organisationId,
        riskAnalysisRunId: risk.id,
        supersededAt: null,
        tenderId,
        tenderVersionId: versionId,
      },
    });
    if (decision?.decision !== "CONTINUE")
      throw new ConflictException(
        "A current authorised CONTINUE decision is required",
      );

    const [profileValues, turnover, readiness, documents, facts] =
      await Promise.all([
        this.database.companyProfileValue.findMany({
          where: { organisationId },
        }),
        this.database.companyTurnover.findMany({ where: { organisationId } }),
        this.database.documentReadiness.findMany({ where: { organisationId } }),
        this.database.document.findMany({
          include: { currentVersion: true },
          where: {
            ...approvedDocument(),
            currentVersion: { approvedObjectKey: { not: null } },
            organisationId,
          },
        }),
        this.database.companyEvidenceFact.findMany({
          include: { currentVersion: { include: { citations: true } } },
          where: { invalidatedAt: null, organisationId },
        }),
      ]);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          decisionId: decision.id,
          documentVersions: documents
            .map((item) => [
              item.currentVersionId,
              item.verificationStatus,
              item.expiryDate?.toISOString() ?? null,
              item.updatedAt.toISOString(),
            ])
            .sort(),
          evidenceVersions: facts
            .map((item) => [
              item.currentVersionId,
              item.currentVersion?.reviewState ?? null,
              item.currentVersion?.citations.map((citation) => [
                citation.id,
                citation.validationStatus,
                citation.invalidatedAt?.toISOString() ?? null,
              ]),
            ])
            .sort(),
          extractionRunId: extraction.id,
          profile: profileValues
            .map((item) => [item.id, item.updatedAt.toISOString()])
            .sort(),
          riskRunId: risk.id,
          turnover: turnover
            .map((item) => [item.id, item.updatedAt.toISOString()])
            .sort(),
          readiness: readiness
            .map((item) => [item.id, item.updatedAt.toISOString()])
            .sort(),
          versionId,
          policy: EVIDENCE_COMPARISON_POLICY_VERSION,
        }),
      )
      .digest("hex");
    const idempotencyKey = `${organisationId}:${clientKey}:${fingerprint}`;
    const existing = await this.database.eligibilityAssessmentRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return existing;

    const run = await this.database.$transaction(async (transaction) => {
      const snapshot = await transaction.eligibilityInputSnapshot.create({
        data: {
          extractionRunId: extraction.id,
          fingerprint,
          organisationId,
          pursuitDecisionId: decision.id,
          riskAnalysisRunId: risk.id,
          tenderVersionId: versionId,
          profileValues: {
            create: profileValues.map((item) => ({
              booleanValue: item.booleanValue,
              dateValue: item.dateValue,
              evidenceDocumentId: item.evidenceDocumentId,
              fieldKey: item.fieldKey,
              numberValue: item.numberValue,
              source: item.source,
              sourceProfileValueId: item.id,
              sourceUpdatedAt: item.updatedAt,
              textListValue: item.textListValue,
              textValue: item.textValue,
              valueType: item.valueType,
              verificationStatus: item.verificationStatus,
            })),
          },
          turnoverRecords: {
            create: turnover.map((item) => ({
              amountInr: item.amountInr,
              evidenceDocumentId: item.evidenceDocumentId,
              financialYear: item.financialYear,
              source: item.source,
              sourceTurnoverId: item.id,
              sourceUpdatedAt: item.updatedAt,
              verificationStatus: item.verificationStatus,
            })),
          },
          documentReadiness: {
            create: readiness.map((item) => ({
              documentType: item.documentType,
              evidenceDocumentId: item.evidenceDocumentId,
              expectedExpiry: item.expectedExpiry,
              readinessStatus: item.readinessStatus,
              source: item.source,
              sourceReadinessId: item.id,
              sourceUpdatedAt: item.updatedAt,
              verificationStatus: item.verificationStatus,
            })),
          },
          documents: {
            create: documents.flatMap((item) =>
              item.currentVersion === null
                ? []
                : [
                    {
                      category: item.category,
                      checksum: item.currentVersion.sha256,
                      documentId: item.id,
                      documentVersionId: item.currentVersion.id,
                      expiryDate: item.expiryDate,
                      verificationStatus: item.verificationStatus,
                    },
                  ],
            ),
          },
          evidenceFacts: {
            create: facts.flatMap((item) =>
              item.currentVersion === null
                ? []
                : [
                    {
                      evidenceFactVersionId: item.currentVersion.id,
                      reviewState: item.currentVersion.reviewState,
                    },
                  ],
            ),
          },
          evidenceCitations: {
            create: facts.flatMap(
              (item) =>
                item.currentVersion?.citations
                  .filter((citation) => citation.invalidatedAt === null)
                  .map((citation) => ({
                    boundedExcerpt: citation.boundedExcerpt,
                    cellRange: citation.cellRange,
                    documentChecksum: citation.documentChecksum,
                    documentVersionId: citation.documentVersionId,
                    evidenceFactVersionId: citation.evidenceFactVersionId,
                    locatorType: citation.locatorType,
                    pageNumber: citation.pageNumber,
                    sectionLabel: citation.sectionLabel,
                    sheetName: citation.sheetName,
                    sourceCreatedAt: citation.createdAt,
                    sourceEvidenceCitationId: citation.id,
                    validationStatus: citation.validationStatus,
                  })) ?? [],
            ),
          },
        },
      });
      const created = await transaction.eligibilityAssessmentRun.create({
        data: {
          comparisonPolicyVersion: EVIDENCE_COMPARISON_POLICY_VERSION,
          extractionRunId: extraction.id,
          idempotencyKey,
          normalisationPolicyVersion: EVIDENCE_NORMALISATION_POLICY_VERSION,
          organisationId,
          pursuitDecisionId: decision.id,
          requestedByUserId: userId,
          riskAnalysisRunId: risk.id,
          snapshotId: snapshot.id,
          sourceFingerprint: fingerprint,
          tenderId,
          tenderVersionId: versionId,
          triggerType,
        },
      });
      await transaction.auditEvent.createMany({
        data: [
          {
            actorUserId: userId,
            eventType:
              triggerType === "RETRY"
                ? "ELIGIBILITY_ASSESSMENT_RETRIED"
                : "ELIGIBILITY_ASSESSMENT_STARTED",
            organisationId,
            outcome: "SUCCESS",
            requestId,
            subjectId: created.id,
            subjectType: "eligibility_assessment_run",
          },
          {
            actorUserId: userId,
            eventType: "ELIGIBILITY_SNAPSHOT_CREATED",
            organisationId,
            outcome: "SUCCESS",
            requestId,
            subjectId: snapshot.id,
            subjectType: "eligibility_input_snapshot",
          },
        ],
      });
      return created;
    });
    await this.jobs.add(
      "compare-company-evidence",
      { assessmentRunId: run.id, organisationId, requestId },
      {
        attempts: 2,
        backoff: { delay: 2000, type: "exponential" },
        jobId: run.id,
        removeOnComplete: 100,
      },
    );
    return run;
  }

  public listRuns(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    return this.database.eligibilityAssessmentRun.findMany({
      include: { snapshot: { select: { capturedAt: true } } },
      orderBy: { createdAt: "desc" },
      where: { organisationId, tenderId, tenderVersionId: versionId },
    });
  }

  public async current(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      include: { activeEligibilityAssessmentRun: true },
      where: { id: versionId, tender: { id: tenderId, organisationId } },
    });
    if (
      version?.activeEligibilityAssessmentRun === null ||
      version?.activeEligibilityAssessmentRun === undefined
    )
      throw new NotFoundException();
    return version.activeEligibilityAssessmentRun;
  }

  public async getRun(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.eligibilityAssessmentRun.findFirst({
      include: { snapshot: true },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async matrix(
    organisationId: string,
    tenderId: string,
    runId: string,
    filter: AssessmentFilter,
  ): Promise<unknown> {
    await this.getRun(organisationId, tenderId, runId);
    const where = {
      assessmentRunId: runId,
      organisationId,
      ...(filter.category === undefined
        ? {}
        : { requirementCategory: filter.category }),
      ...(filter.obligation === undefined
        ? {}
        : { requirementObligation: filter.obligation }),
      ...(filter.proposed_state === undefined
        ? {}
        : { proposedState: filter.proposed_state }),
      ...(filter.review_state === undefined
        ? {}
        : { reviewState: filter.review_state }),
      ...(filter.state === undefined ? {} : { currentState: filter.state }),
      ...(filter.conflict === undefined
        ? {}
        : {
            currentState:
              filter.conflict === "true"
                ? ("CONFLICT" as const)
                : { not: "CONFLICT" as const },
          }),
    };
    const [items, total, counts] = await Promise.all([
      this.database.eligibilityAssessment.findMany({
        include: {
          evidenceLinks: {
            include: { evidenceCitation: true, evidenceFactVersion: true },
          },
          reviews: { orderBy: { reviewVersion: "asc" } },
          structuredRequirement: true,
          tenderCitation: true,
        },
        orderBy: { createdAt: "asc" },
        skip: filter.offset,
        take: filter.limit,
        where,
      }),
      this.database.eligibilityAssessment.count({ where }),
      this.database.eligibilityAssessment.groupBy({
        _count: true,
        by: ["currentState"],
        where: { assessmentRunId: runId, organisationId },
      }),
    ]);
    return { counts, items, total };
  }

  public async cancel(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.eligibilityAssessmentRun.updateMany({
      data: { cancellationRequestedAt: new Date() },
      where: {
        id: runId,
        organisationId,
        status: { in: ["QUEUED", "SNAPSHOTTING", "MATCHING", "VALIDATING"] },
        tenderId,
      },
    });
    if (result.count !== 1) throw new ConflictException();
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "ELIGIBILITY_ASSESSMENT_CANCELLED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: runId,
        subjectType: "eligibility_assessment_run",
      },
    });
    return { cancellation_requested: true };
  }

  public async retry(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    clientKey: string,
    requestId: string,
  ): Promise<unknown> {
    const run = await this.database.eligibilityAssessmentRun.findFirst({
      where: {
        id: runId,
        organisationId,
        status: { in: ["FAILED", "CANCELLED", "INVALIDATED"] },
        tenderId,
      },
    });
    if (run === null) throw new ConflictException();
    return this.start(
      organisationId,
      tenderId,
      run.tenderVersionId,
      userId,
      clientKey,
      requestId,
      "RETRY",
    );
  }

  public events(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Observable<MessageEvent> {
    const terminal = from(
      this.waitForTerminal(organisationId, tenderId, runId),
    );
    return concat(
      from(this.safeEvent(organisationId, tenderId, runId)).pipe(
        map((data): MessageEvent => ({ data })),
      ),
      interval(2000).pipe(
        map((): MessageEvent => ({ data: { heartbeat: true } })),
        takeUntil(terminal),
      ),
      terminal.pipe(map((data): MessageEvent => ({ data }))),
    );
  }

  public async createFact(
    organisationId: string,
    input: CreateEvidenceFactRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const document = await this.approvedDocument(
      organisationId,
      input.document_id,
      input.document_version_id,
    );
    const result = await this.database.$transaction(async (transaction) => {
      const fact = await transaction.companyEvidenceFact.create({
        data: {
          createdByUserId: userId,
          documentId: document.id,
          factType: input.fact_type,
          organisationId,
        },
      });
      const version = await transaction.companyEvidenceFactVersion.create({
        data: {
          ...typedValue(input.value),
          createdByUserId: userId,
          documentVersionId: input.document_version_id,
          evidenceFactId: fact.id,
          issuingAuthority: input.issuing_authority ?? null,
          scope: input.scope ?? null,
          validFrom: input.valid_from ?? null,
          validUntil: input.valid_until ?? null,
          valueType: input.value.value_type,
          versionNumber: 1,
        },
      });
      await transaction.companyEvidenceFact.update({
        data: { currentVersionId: version.id },
        where: { id: fact.id },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "COMPANY_EVIDENCE_FACT_CREATED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: fact.id,
          subjectType: "company_evidence_fact",
        },
      });
      return { ...fact, currentVersion: version };
    });
    await this.invalidateOrganisationRuns(organisationId);
    return result;
  }

  public facts(organisationId: string): Promise<unknown> {
    return this.database.companyEvidenceFact.findMany({
      include: {
        currentVersion: { include: { citations: true } },
        reviews: { orderBy: { reviewVersion: "asc" } },
        versions: { orderBy: { versionNumber: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      where: { organisationId },
    });
  }

  public async correctFact(
    organisationId: string,
    factId: string,
    input: Omit<
      CreateEvidenceFactRequest,
      "document_id" | "document_version_id"
    >,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const fact = await this.database.companyEvidenceFact.findFirst({
      include: { currentVersion: true },
      where: { id: factId, invalidatedAt: null, organisationId },
    });
    if (fact?.currentVersion === null || fact?.currentVersion === undefined)
      throw new NotFoundException();
    const current = fact.currentVersion;
    await this.approvedDocument(
      organisationId,
      fact.documentId,
      current.documentVersionId,
    );
    const version = await this.database.$transaction(async (transaction) => {
      const aggregate = await transaction.companyEvidenceFactVersion.aggregate({
        _max: { versionNumber: true },
        where: { evidenceFactId: fact.id },
      });
      const created = await transaction.companyEvidenceFactVersion.create({
        data: {
          ...typedValue(input.value),
          createdByUserId: userId,
          documentVersionId: current.documentVersionId,
          evidenceFactId: fact.id,
          issuingAuthority: input.issuing_authority ?? null,
          scope: input.scope ?? null,
          validFrom: input.valid_from ?? null,
          validUntil: input.valid_until ?? null,
          valueType: input.value.value_type,
          versionNumber: (aggregate._max.versionNumber ?? 0) + 1,
        },
      });
      await transaction.companyEvidenceFact.update({
        data: { currentVersionId: created.id },
        where: { id: fact.id },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "COMPANY_EVIDENCE_FACT_VERSION_CREATED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: created.id,
          subjectType: "company_evidence_fact_version",
        },
      });
      return created;
    });
    await this.invalidateOrganisationRuns(organisationId);
    return version;
  }

  public async citeFact(
    organisationId: string,
    factId: string,
    input: CreateCompanyCitationRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const fact = await this.database.companyEvidenceFact.findFirst({
      include: { currentVersion: true },
      where: { id: factId, invalidatedAt: null, organisationId },
    });
    if (fact?.currentVersion === null || fact?.currentVersion === undefined)
      throw new NotFoundException();
    const document = await this.approvedDocument(
      organisationId,
      input.document_id,
      input.document_version_id,
    );
    if (
      fact.documentId !== document.id ||
      fact.currentVersion.documentVersionId !== input.document_version_id
    )
      throw new UnprocessableEntityException(
        "Citation must target the fact's exact source version",
      );
    const citation = await this.database.companyEvidenceCitation.create({
      data: {
        boundedExcerpt: input.bounded_excerpt,
        cellRange: input.cell_range ?? null,
        createdByUserId: userId,
        documentCategory: document.category,
        documentChecksum: document.currentVersion?.sha256 ?? "",
        documentId: document.id,
        documentName: document.displayName,
        documentVersionId: input.document_version_id,
        evidenceFactVersionId: fact.currentVersion.id,
        locatorType:
          input.sheet_name === undefined
            ? "HUMAN_CAPTURED_DOCUMENT"
            : "HUMAN_CAPTURED_SPREADSHEET",
        organisationId,
        pageNumber: input.page_number ?? null,
        sectionLabel: input.section_label ?? null,
        sheetName: input.sheet_name ?? null,
      },
    });
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "COMPANY_EVIDENCE_CITATION_CREATED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: citation.id,
        subjectType: "company_evidence_citation",
      },
    });
    await this.invalidateOrganisationRuns(organisationId);
    return citation;
  }

  public async reviewFact(
    organisationId: string,
    factId: string,
    input: EvidenceFactReviewRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const fact = await this.database.companyEvidenceFact.findFirst({
      include: { currentVersion: { include: { citations: true } } },
      where: { id: factId, invalidatedAt: null, organisationId },
    });
    if (fact?.currentVersion === null || fact?.currentVersion === undefined)
      throw new NotFoundException();
    const currentVersion = fact.currentVersion;
    if (input.action === "ACCEPT" && currentVersion.citations.length === 0)
      throw new UnprocessableEntityException(
        "Accepted document facts require an exact citation",
      );
    const state = factState(input.action);
    const review = await this.database.$transaction(async (transaction) => {
      const aggregate = await transaction.companyEvidenceReview.aggregate({
        _max: { reviewVersion: true },
        where: { evidenceFactId: factId },
      });
      const review = await transaction.companyEvidenceReview.create({
        data: {
          action: input.action,
          actorUserId: userId,
          evidenceFactId: fact.id,
          evidenceFactVersionId: currentVersion.id,
          newState: state,
          organisationId,
          previousState: currentVersion.reviewState,
          rationale: input.rationale,
          reviewVersion: (aggregate._max.reviewVersion ?? 0) + 1,
        },
      });
      await transaction.companyEvidenceFactVersion.update({
        data: { reviewState: state },
        where: { id: currentVersion.id },
      });
      if (state === "ACCEPTED")
        await transaction.companyEvidenceCitation.updateMany({
          data: { validationStatus: "VALID" },
          where: {
            evidenceFactVersionId: currentVersion.id,
            invalidatedAt: null,
            organisationId,
          },
        });
      if (state === "INVALIDATED")
        await transaction.companyEvidenceFact.update({
          data: { invalidatedAt: new Date() },
          where: { id: fact.id },
        });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "COMPANY_EVIDENCE_FACT_REVIEWED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: fact.id,
          subjectType: "company_evidence_fact",
        },
      });
      return review;
    });
    await this.invalidateOrganisationRuns(organisationId);
    return review;
  }

  public async reviewAssessment(
    organisationId: string,
    tenderId: string,
    runId: string,
    assessmentId: string,
    input: AssessmentReviewRequest,
    userId: string,
    requestId: string,
    mayFinalise: boolean,
  ): Promise<unknown> {
    const assessment = await this.database.eligibilityAssessment.findFirst({
      include: {
        assessmentRun: true,
        evidenceLinks: {
          include: { evidenceCitation: true, evidenceFactVersion: true },
        },
        tenderCitation: true,
      },
      where: {
        assessmentRunId: runId,
        id: assessmentId,
        organisationId,
        tenderId,
      },
    });
    if (
      assessment?.assessmentRun.status !== "COMPLETE" ||
      assessment.assessmentRun.invalidatedAt !== null
    )
      throw new ConflictException();
    const nextState = reviewStateFor(input, assessment.proposedState);
    if (
      ["MARK_VERIFIED", "MARK_NOT_APPLICABLE", "RESOLVE_CONFLICT"].includes(
        input.action,
      ) &&
      !mayFinalise
    )
      throw new ForbiddenException();
    const direct = assessment.evidenceLinks.filter(
      (link) => link.linkType === "DIRECT_SUPPORT",
    );
    if (
      input.action === "MARK_VERIFIED" &&
      !canHumanFinaliseVerified({
        directCompanyCitationValid: direct.some(
          (link) =>
            link.evidenceCitation?.validationStatus === "VALID" &&
            link.evidenceCitation.invalidatedAt === null,
        ),
        evidenceApprovedAndCurrent: direct.some(
          (link) => link.evidenceFactVersion?.reviewState === "ACCEPTED",
        ),
        hasDirectSupport: direct.length > 0,
        hasUnresolvedConflict: assessment.evidenceLinks.some(
          (link) => link.linkType === "CONTRADICTS",
        ),
        rationale: input.rationale,
        tenderCitationValid:
          assessment.tenderCitation.validationStatus === "VALID",
      })
    )
      throw new UnprocessableEntityException(
        "VERIFIED requires current direct cited evidence and no unresolved conflict",
      );
    if (
      (input.action === "MARK_NOT_APPLICABLE" ||
        input.action === "RESOLVE_CONFLICT") &&
      input.rationale.trim().length < 20
    )
      throw new UnprocessableEntityException(
        "A detailed human rationale is required",
      );
    const review = await this.database.$transaction(async (transaction) => {
      const aggregate = await transaction.eligibilityAssessmentReview.aggregate(
        {
          _max: { reviewVersion: true },
          where: { assessmentId },
        },
      );
      const nextReviewState =
        input.action === "REOPEN"
          ? "HUMAN_REVIEW_REQUIRED"
          : input.action === "REQUEST_HUMAN_REVIEW"
            ? "HUMAN_REVIEW_REQUIRED"
            : "FINALISED";
      const review = await transaction.eligibilityAssessmentReview.create({
        data: {
          action: input.action,
          actorUserId: userId,
          assessmentId,
          newReviewState: nextReviewState,
          newState: nextState,
          organisationId,
          previousReviewState: assessment.reviewState,
          previousState: assessment.currentState,
          rationale: input.rationale,
          reviewVersion: (aggregate._max.reviewVersion ?? 0) + 1,
        },
      });
      await transaction.eligibilityAssessment.update({
        data: {
          currentState: nextState,
          finalRationale: input.rationale,
          finalisedAt: nextReviewState === "FINALISED" ? new Date() : null,
          finalisedByUserId: nextReviewState === "FINALISED" ? userId : null,
          reviewState: nextReviewState,
        },
        where: { id: assessmentId },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType:
            input.action === "MARK_VERIFIED"
              ? "ELIGIBILITY_ASSESSMENT_VERIFIED"
              : input.action === "MARK_NOT_APPLICABLE"
                ? "ELIGIBILITY_ASSESSMENT_NOT_APPLICABLE"
                : input.action === "RESOLVE_CONFLICT"
                  ? "ELIGIBILITY_CONFLICT_RESOLVED"
                  : "ELIGIBILITY_ASSESSMENT_REVIEWED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: assessmentId,
          subjectType: "eligibility_assessment",
        },
      });
      return review;
    });
    await this.invalidateChecklistRuns(organisationId, runId);
    return review;
  }

  public async linkEvidence(
    organisationId: string,
    tenderId: string,
    runId: string,
    assessmentId: string,
    input: LinkAssessmentEvidenceRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const assessment = await this.database.eligibilityAssessment.findFirst({
      include: { assessmentRun: true },
      where: {
        assessmentRunId: runId,
        id: assessmentId,
        organisationId,
        tenderId,
      },
    });
    if (
      assessment?.assessmentRun.status !== "COMPLETE" ||
      assessment.assessmentRun.invalidatedAt !== null
    )
      throw new ConflictException();
    const fact = await this.database.companyEvidenceFactVersion.findFirst({
      include: {
        citations: {
          where: { invalidatedAt: null, validationStatus: "VALID" },
        },
        evidenceFact: true,
      },
      where: {
        evidenceFact: { invalidatedAt: null, organisationId },
        id: input.evidence_fact_version_id,
        snapshotFacts: {
          some: { snapshotId: assessment.assessmentRun.snapshotId },
        },
      },
    });
    if (fact === null) throw new NotFoundException();
    if (
      input.link_type === "DIRECT_SUPPORT" &&
      (fact.reviewState !== "ACCEPTED" || fact.citations.length === 0)
    )
      throw new UnprocessableEntityException(
        "Direct support requires an accepted fact with a valid citation",
      );
    const link = await this.database.eligibilityAssessmentEvidenceLink.create({
      data: {
        assessmentId,
        evidenceCitationId: fact.citations[0]?.id ?? null,
        evidenceFactVersionId: fact.id,
        linkType: input.link_type,
        relevance: input.link_type === "DIRECT_SUPPORT" ? 1 : 0.6,
        scope: input.scope ?? null,
      },
    });
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "ELIGIBILITY_EVIDENCE_LINKED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: assessmentId,
        subjectType: "eligibility_assessment",
      },
    });
    await this.invalidateChecklistRuns(organisationId, runId);
    return link;
  }

  public async unlinkEvidence(
    organisationId: string,
    tenderId: string,
    runId: string,
    assessmentId: string,
    linkId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result =
      await this.database.eligibilityAssessmentEvidenceLink.deleteMany({
        where: {
          assessment: {
            assessmentRunId: runId,
            id: assessmentId,
            organisationId,
            tenderId,
          },
          id: linkId,
        },
      });
    if (result.count !== 1) throw new NotFoundException();
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "ELIGIBILITY_EVIDENCE_UNLINKED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: assessmentId,
        subjectType: "eligibility_assessment",
      },
    });
    await this.invalidateChecklistRuns(organisationId, runId);
    return { unlinked: true };
  }

  private async approvedDocument(
    organisationId: string,
    documentId: string,
    versionId: string,
  ): Promise<Prisma.DocumentGetPayload<{ include: { currentVersion: true } }>> {
    const document = await this.database.document.findFirst({
      include: { currentVersion: true },
      where: {
        ...approvedDocument(),
        currentVersionId: versionId,
        id: documentId,
        organisationId,
        versions: { some: { approvedObjectKey: { not: null }, id: versionId } },
      },
    });
    if (document === null) throw new NotFoundException();
    return document;
  }

  private async invalidateOrganisationRuns(
    organisationId: string,
  ): Promise<void> {
    const now = new Date();
    await this.database.$transaction([
      this.database.eligibilityAssessmentRun.updateMany({
        data: {
          currentStage: "INVALIDATED",
          invalidatedAt: now,
          publicMessage: "Authoritative company evidence changed",
          status: "INVALIDATED",
        },
        where: { organisationId, status: "COMPLETE" },
      }),
      this.database.eligibilityAssessment.updateMany({
        data: { invalidatedAt: now },
        where: { invalidatedAt: null, organisationId },
      }),
      this.database.checklistGenerationRun.updateMany({
        data: {
          activatedAt: null,
          currentStage: "INVALIDATED",
          invalidatedAt: now,
          publicMessage: "Authoritative company evidence changed",
          status: "INVALIDATED",
        },
        where: { invalidatedAt: null, organisationId },
      }),
      this.database.checklistItem.updateMany({
        data: { invalidatedAt: now, status: "INVALIDATED" },
        where: { invalidatedAt: null, organisationId },
      }),
    ]);
  }

  private async invalidateChecklistRuns(
    organisationId: string,
    assessmentRunId: string,
  ): Promise<void> {
    const invalidatedAt = new Date();
    await this.database.$transaction([
      this.database.checklistGenerationRun.updateMany({
        data: {
          activatedAt: null,
          currentStage: "INVALIDATED",
          invalidatedAt,
          publicMessage: "The Phase 7 assessment changed",
          status: "INVALIDATED",
        },
        where: {
          assessmentRunId,
          invalidatedAt: null,
          organisationId,
        },
      }),
      this.database.checklistItem.updateMany({
        data: { invalidatedAt, status: "INVALIDATED" },
        where: {
          generationRun: { assessmentRunId, organisationId },
          invalidatedAt: null,
        },
      }),
    ]);
  }

  private async safeEvent(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<Record<string, unknown>> {
    const run = await this.database.eligibilityAssessmentRun.findFirst({
      select: {
        currentStage: true,
        eventSequence: true,
        id: true,
        progressPercentage: true,
        status: true,
        tenderId: true,
        tenderVersionId: true,
        updatedAt: true,
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return { ...run };
  }

  private async waitForTerminal(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const event = await this.safeEvent(organisationId, tenderId, runId);
      if (
        typeof event === "object" &&
        event !== null &&
        "status" in event &&
        ["COMPLETE", "FAILED", "CANCELLED", "INVALIDATED"].includes(
          String(event.status),
        )
      )
        return event;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return { status: "CONNECTION_CLOSED" };
  }
}

function approvedDocument(): {
  readonly deletedAt: null;
  readonly status: "READY";
} {
  return {
    deletedAt: null,
    status: "READY" as const,
  };
}

function typedValue(value: CreateEvidenceFactRequest["value"]): {
  readonly booleanValue: boolean | null;
  readonly currency: string | null;
  readonly dateValue: Date | null;
  readonly financialYear: string | null;
  readonly numberValue: number | null;
  readonly textListValue: string[];
  readonly textValue: string | null;
  readonly unit: string | null;
} {
  return {
    booleanValue: value.boolean_value ?? null,
    currency: value.currency ?? null,
    dateValue: value.date_value ?? null,
    financialYear: value.financial_year ?? null,
    numberValue: value.number_value ?? null,
    textListValue: value.text_list_value ?? [],
    textValue: value.text_value ?? null,
    unit: value.unit ?? null,
  };
}

function factState(
  action: EvidenceFactReviewRequest["action"],
): "ACCEPTED" | "REJECTED" | "INVALIDATED" | "HUMAN_REVIEW_REQUIRED" {
  if (action === "ACCEPT") return "ACCEPTED" as const;
  if (action === "REJECT") return "REJECTED" as const;
  if (action === "INVALIDATE") return "INVALIDATED" as const;
  return "HUMAN_REVIEW_REQUIRED" as const;
}

function reviewStateFor(
  input: AssessmentReviewRequest,
  proposedState:
    | "VERIFIED"
    | "LIKELY_MET"
    | "MISSING"
    | "CONFLICT"
    | "NOT_APPLICABLE"
    | "HUMAN_REVIEW_REQUIRED",
):
  | "VERIFIED"
  | "LIKELY_MET"
  | "MISSING"
  | "CONFLICT"
  | "NOT_APPLICABLE"
  | "HUMAN_REVIEW_REQUIRED" {
  if (input.action === "ACCEPT_PROPOSAL") return proposedState;
  if (input.action === "MARK_VERIFIED") return "VERIFIED" as const;
  if (input.action === "MARK_LIKELY_MET") return "LIKELY_MET" as const;
  if (input.action === "MARK_MISSING") return "MISSING" as const;
  if (input.action === "MARK_CONFLICT") return "CONFLICT" as const;
  if (input.action === "MARK_NOT_APPLICABLE") return "NOT_APPLICABLE" as const;
  if (input.action === "RESOLVE_CONFLICT")
    return input.chosen_state ?? "HUMAN_REVIEW_REQUIRED";
  return "HUMAN_REVIEW_REQUIRED" as const;
}
