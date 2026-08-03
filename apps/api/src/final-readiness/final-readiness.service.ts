/* eslint-disable @typescript-eslint/explicit-function-return-type -- Prisma query helpers preserve generated payload inference. */
import {
  ConflictException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateFinalReadinessDispositionRequest,
  FinalReadinessFindingFilter,
  FinalReadinessPagination,
  ReviewFinalReadinessFindingRequest,
} from "@tender/contracts";
import { Prisma, type PrismaClient, type Role } from "@tender/database";
import {
  consolidatedDraftQualificationDenials,
  evaluateFinalReadinessPrerequisites,
  finalReadinessDispositionDenials,
  FINAL_READINESS_EXPIRY_POLICY_VERSION,
  FINAL_READINESS_POLICY_VERSION,
  FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
  normaliseFinalReadinessFingerprintInput,
  type FinalReadinessPrerequisiteInput,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { JOB_QUEUE, PRISMA_CLIENT } from "../infrastructure.tokens.js";
import { FinalReadinessError } from "./final-readiness.error.js";
import { FinalReadinessFreshnessService } from "./final-readiness-freshness.service.js";

type Database = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class FinalReadinessService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    private readonly freshness: FinalReadinessFreshnessService,
  ) {}

  public async preflight(
    organisationId: string,
    tenderId: string,
    userId: string,
  ): Promise<unknown> {
    const authority = await this.loadAuthority(
      this.database,
      organisationId,
      tenderId,
    );
    const independent =
      authority.draft === null
        ? null
        : await this.database.organisationMembership.findFirst({
            select: { id: true },
            where: {
              organisationId,
              revokedAt: null,
              role: { in: ["OWNER", "ADMIN", "REVIEWER"] },
              userId: {
                notIn: [userId, authority.draft.version.createdByUserId],
              },
            },
          });
    return {
      eligible_independent_decision_actor_exists: independent !== null,
      evaluated_at: new Date().toISOString(),
      hard_prerequisites_pass: authority.denials.length === 0,
      informational_only: true,
      policy_version: FINAL_READINESS_POLICY_VERSION,
      prerequisite_denials: authority.denials.map(({ code, prerequisite }) => ({
        code,
        prerequisite,
      })),
      qualifying_consolidated_draft_version_id:
        authority.draft?.qualified === true ? authority.draft.version.id : null,
      tender_version_id:
        authority.version?.id ?? authority.tender?.currentVersionId,
      transactional_revalidation_required: true,
    };
  }

  public async start(
    organisationId: string,
    tenderId: string,
    userId: string,
    clientKey: string,
    requestId: string,
    auditEvent:
      | "FINAL_READINESS_STARTED"
      | "FINAL_READINESS_RETRIED" = "FINAL_READINESS_STARTED",
  ): Promise<unknown> {
    const scopedKey = clientKey;
    const existing = await this.database.finalReadinessRun.findFirst({
      include: { finalRiskRun: { select: { id: true } } },
      where: { idempotencyKey: scopedKey, organisationId, tenderId },
    });
    if (existing !== null) return this.startResponse(existing);

    let run: Awaited<ReturnType<FinalReadinessService["createRun"]>> | null =
      null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        run = await this.database.$transaction(
          (transaction) =>
            this.createRun(
              transaction,
              organisationId,
              tenderId,
              userId,
              scopedKey,
              requestId,
              auditEvent,
            ),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        break;
      } catch (error: unknown) {
        if (isSerializationConflict(error) && attempt < 2) continue;
        if (isUniqueConflict(error)) {
          const replay = await this.database.finalReadinessRun.findFirst({
            include: { finalRiskRun: { select: { id: true } } },
            where: { idempotencyKey: scopedKey, organisationId, tenderId },
          });
          if (replay !== null) return this.startResponse(replay);
          throw new FinalReadinessError(
            "FINAL_READINESS_ALREADY_ACTIVE",
            "A final-readiness audit is already active.",
            HttpStatus.CONFLICT,
          );
        }
        throw error;
      }
    }
    if (run === null)
      throw new FinalReadinessError(
        "FINAL_READINESS_IDEMPOTENCY_CONFLICT",
        "The final-readiness request could not be serialized.",
        HttpStatus.CONFLICT,
      );
    try {
      await this.jobs.add(
        "run-final-readiness-audit",
        {
          finalReadinessRunId: run.id,
          kind: "FINAL_READINESS",
          organisationId,
          requestId,
        },
        {
          attempts: 2,
          backoff: { delay: 2_000, type: "exponential" },
          jobId: run.id,
          removeOnComplete: 100,
        },
      );
    } catch {
      await this.database.finalReadinessRun.update({
        data: {
          eventSequence: { increment: 1 },
          failedAt: new Date(),
          safeFailureCode: "QUEUE_DELIVERY_FAILED",
          status: "FAILED",
        },
        where: { id: run.id },
      });
      throw new FinalReadinessError(
        "FINAL_READINESS_SOURCE_INVALID",
        "The final-readiness audit could not be queued safely.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.startResponse(run);
  }

  public async current(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      include: { activeFinalReadinessRun: true },
      where: { id: versionId, tender: { id: tenderId, organisationId } },
    });
    if (version === null) throw new NotFoundException();
    return {
      run:
        version.activeFinalReadinessRun === null
          ? null
          : await this.run(
              organisationId,
              tenderId,
              version.activeFinalReadinessRun.id,
            ),
    };
  }

  public async history(
    organisationId: string,
    tenderId: string,
    versionId: string,
    pagination: FinalReadinessPagination,
  ): Promise<unknown> {
    const items = await this.database.finalReadinessRun.findMany({
      orderBy: { createdAt: "desc" },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit + 1,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { organisationId, tenderId, tenderVersionId: versionId },
    });
    const visibleItems = await Promise.all(
      items
        .slice(0, pagination.limit)
        .map(({ id }) => this.run(organisationId, tenderId, id)),
    );
    return {
      items: visibleItems,
      next_cursor:
        items.length > pagination.limit
          ? (items[pagination.limit - 1]?.id ?? null)
          : null,
    };
  }

  public async run(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.finalReadinessRun.findFirst({
      include: {
        decisions: {
          include: { actor: { select: { displayName: true, id: true } } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        finalRiskRun: true,
        findings: { select: { treatment: true } },
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    const freshness = await this.freshness.evaluate(
      organisationId,
      tenderId,
      runId,
    );
    if (run.finalRiskRun === null)
      throw new FinalReadinessError(
        "FINAL_READINESS_SOURCE_INVALID",
        "The linked final-risk record is unavailable.",
        HttpStatus.CONFLICT,
      );
    return runResponse(run, freshness.fresh);
  }

  public async progress(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.finalReadinessRun.findFirst({
      select: {
        currentStage: true,
        progressPercentage: true,
        status: true,
        updatedAt: true,
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return {
      occurred_at: run.updatedAt.toISOString(),
      progress_percent: run.progressPercentage,
      run_id: runId,
      stage: run.currentStage,
      status: run.status,
    };
  }

  public async findings(
    organisationId: string,
    tenderId: string,
    runId: string,
    filter: FinalReadinessFindingFilter,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    const items = await this.database.finalReadinessFinding.findMany({
      include: {
        provenance: true,
        reviews: {
          include: { actor: { select: { displayName: true, id: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { findingOrder: "asc" },
      skip: filter.cursor === undefined ? 0 : 1,
      take: filter.limit + 1,
      ...(filter.cursor === undefined ? {} : { cursor: { id: filter.cursor } }),
      where: {
        ...(filter.lifecycle_state === undefined
          ? {}
          : { lifecycle: filter.lifecycle_state }),
        ...(filter.materiality === undefined
          ? {}
          : { materiality: filter.materiality }),
        organisationId,
        ...(filter.review_state === undefined
          ? {}
          : { reviewState: filter.review_state }),
        ...(filter.rule_code === undefined
          ? {}
          : { ruleCode: filter.rule_code }),
        runId,
        ...(filter.treatment === undefined
          ? {}
          : { treatment: filter.treatment }),
        tenderId,
      },
    });
    return {
      items: items.slice(0, filter.limit).map(safeFinding),
      next_cursor:
        items.length > filter.limit
          ? (items[filter.limit - 1]?.id ?? null)
          : null,
    };
  }

  public async finding(
    organisationId: string,
    tenderId: string,
    runId: string,
    findingId: string,
  ): Promise<unknown> {
    const finding = await this.database.finalReadinessFinding.findFirst({
      include: {
        provenance: true,
        reviews: {
          include: { actor: { select: { displayName: true, id: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
      where: { id: findingId, organisationId, run: { id: runId, tenderId } },
    });
    if (finding === null) throw new NotFoundException();
    return safeFinding(finding);
  }

  public async reviewFinding(
    organisationId: string,
    tenderId: string,
    runId: string,
    findingId: string,
    input: ReviewFinalReadinessFindingRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    await this.requireFresh(organisationId, tenderId, runId);
    return this.database.$transaction(async (transaction) => {
      const finding = await transaction.finalReadinessFinding.findFirst({
        where: { id: findingId, organisationId, runId, tenderId },
      });
      if (finding === null) throw new NotFoundException();
      const aggregate = await transaction.finalReadinessFindingReview.aggregate(
        {
          _max: { reviewVersion: true },
          where: { findingId },
        },
      );
      const currentVersion = aggregate._max.reviewVersion ?? 0;
      if (currentVersion !== input.expected_current_review_version)
        throw new ConflictException();
      const review = await transaction.finalReadinessFindingReview.create({
        data: {
          acknowledgementRecorded: input.acknowledgement_recorded,
          action: input.action,
          actorUserId: userId,
          findingId,
          organisationId,
          rationale: input.rationale,
          reviewVersion: currentVersion + 1,
        },
        include: { actor: { select: { displayName: true, id: true } } },
      });
      await transaction.finalReadinessFinding.update({
        data: {
          lifecycle: input.action === "REOPEN" ? "OPEN" : "UNDER_REVIEW",
          reviewState:
            input.action === "REOPEN" ? "HUMAN_REVIEW_REQUIRED" : "REVIEWED",
        },
        where: { id: findingId },
      });
      await transaction.auditEvent.create({
        data: audit(
          "FINAL_READINESS_FINDING_REVIEWED",
          organisationId,
          userId,
          findingId,
          "final_readiness_finding",
          requestId,
        ),
      });
      return reviewResponse(review);
    });
  }

  public async createDisposition(
    organisationId: string,
    tenderId: string,
    input: CreateFinalReadinessDispositionRequest,
    userId: string,
    role: "OWNER" | "ADMIN" | "TENDER_EXECUTIVE" | "CONSULTANT" | "REVIEWER",
    requestId: string,
  ): Promise<unknown> {
    await this.requireFresh(organisationId, tenderId, input.run_id);
    return this.database.$transaction(
      async (transaction) => {
        const run = await transaction.finalReadinessRun.findFirst({
          include: {
            finalRiskRun: true,
            findings: { include: { reviews: true } },
            inputSnapshot: { include: { requiredDrafts: true } },
          },
          where: { id: input.run_id, organisationId, tenderId },
        });
        if (run === null) throw new NotFoundException();
        const active = await transaction.tenderVersion.findFirst({
          select: { activeFinalReadinessRunId: true },
          where: { id: run.tenderVersionId, tenderId },
        });
        const blockers = run.findings.filter(
          ({ lifecycle, treatment }) =>
            treatment === "BLOCKER" &&
            !["RESOLVED", "SUPERSEDED"].includes(lifecycle),
        ).length;
        const required = run.findings.filter(
          ({ lifecycle, treatment }) =>
            treatment === "HUMAN_DISPOSITION_REQUIRED" &&
            !["RESOLVED", "DISPOSITION_RECORDED", "SUPERSEDED"].includes(
              lifecycle,
            ),
        ).length;
        const requiredAcknowledgements = run.findings
          .filter(({ treatment }) => treatment === "HUMAN_DISPOSITION_REQUIRED")
          .map(({ id }) => id);
        const denials = finalReadinessDispositionDenials({
          actorHasDecisionPermission: ["OWNER", "ADMIN", "REVIEWER"].includes(
            role,
          ),
          actorUserId: userId,
          consolidatedDraftCreatorUserId:
            run.inputSnapshot?.requiredDrafts[0]?.draftCreatorUserId ?? "",
          disposition: input.disposition,
          finalRiskRunComplete: run.finalRiskRun?.status === "COMPLETE",
          finalRiskRunCurrent: run.finalRiskRun?.invalidatedAt === null,
          fingerprintMatches:
            input.expected_fingerprint === run.inputFingerprint,
          invalidated:
            run.invalidatedAt !== null || run.status === "INVALIDATED",
          materialFindingProvenanceValid: run.findings
            .filter(({ materiality }) => materiality !== "NON_MATERIAL")
            .every(({ provenanceValid }) => provenanceValid),
          rationale: input.rationale,
          readinessRunComplete: run.status === "COMPLETED",
          readinessRunCurrent: active?.activeFinalReadinessRunId === run.id,
          requesterUserId: run.requestedByUserId,
          requiredAcknowledgementsRecorded: requiredAcknowledgements.every(
            (id) => input.acknowledgement_ids.includes(id),
          ),
          unresolvedBlockers: blockers,
          unresolvedHumanDispositions: required,
        });
        if (denials.length > 0) throw dispositionError(denials);
        const prior = await transaction.finalReadinessDecision.findFirst({
          where: { runId: run.id, supersededAt: null },
        });
        const now = new Date();
        if (prior !== null) {
          await transaction.finalReadinessDecision.update({
            data: { supersededAt: now },
            where: { id: prior.id },
          });
          await transaction.auditEvent.create({
            data: audit(
              "FINAL_READINESS_DISPOSITION_SUPERSEDED",
              organisationId,
              userId,
              prior.id,
              "final_readiness_decision",
              requestId,
            ),
          });
        }
        const decision = await transaction.finalReadinessDecision.create({
          data: {
            acknowledgements: {
              create: input.acknowledgement_ids.map((findingId) => ({
                findingId,
              })),
            },
            actorRoleAtDecision: role,
            actorUserId: userId,
            disposition: input.disposition,
            organisationId,
            rationale: input.rationale,
            runFingerprint: run.inputFingerprint,
            runId: run.id,
            supersedesDecisionId: prior?.id ?? null,
            tenderId,
          },
          include: { actor: { select: { displayName: true, id: true } } },
        });
        await transaction.auditEvent.create({
          data: audit(
            "FINAL_READINESS_DISPOSITION_RECORDED",
            organisationId,
            userId,
            decision.id,
            "final_readiness_decision",
            requestId,
          ),
        });
        return decisionResponse(decision);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async decisions(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    const items = await this.database.finalReadinessDecision.findMany({
      include: {
        acknowledgements: true,
        actor: { select: { displayName: true, id: true } },
      },
      orderBy: { createdAt: "desc" },
      where: { organisationId, runId, tenderId },
    });
    return { items: items.map(decisionResponse) };
  }

  public async cancel(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.finalReadinessRun.updateMany({
      data: {
        cancellationRequestedAt: new Date(),
        eventSequence: { increment: 1 },
      },
      where: {
        id: runId,
        organisationId,
        status: { in: ["QUEUED", "PROCESSING"] },
        tenderId,
      },
    });
    if (result.count !== 1)
      throw new FinalReadinessError(
        "FINAL_READINESS_RUN_NOT_COMPLETE",
        "The final-readiness run cannot be cancelled in its current state.",
        HttpStatus.CONFLICT,
      );
    await this.database.auditEvent.create({
      data: audit(
        "FINAL_READINESS_CANCELLED",
        organisationId,
        userId,
        runId,
        "final_readiness_run",
        requestId,
      ),
    });
    return { cancellation_requested: true };
  }

  public async retry(
    organisationId: string,
    tenderId: string,
    priorRunId: string,
    userId: string,
    clientKey: string,
    requestId: string,
  ): Promise<unknown> {
    const prior = await this.requireRun(organisationId, tenderId, priorRunId);
    if (!["FAILED", "CANCELLED"].includes(prior.status))
      throw new FinalReadinessError(
        "FINAL_READINESS_RUN_NOT_RETRYABLE",
        "The final-readiness run is not retryable.",
        HttpStatus.CONFLICT,
      );
    return this.start(
      organisationId,
      tenderId,
      userId,
      clientKey,
      requestId,
      "FINAL_READINESS_RETRIED",
    );
  }

  private async createRun(
    transaction: Prisma.TransactionClient,
    organisationId: string,
    tenderId: string,
    userId: string,
    idempotencyKey: string,
    requestId: string,
    auditEvent: "FINAL_READINESS_STARTED" | "FINAL_READINESS_RETRIED",
  ) {
    const authority = await this.loadAuthority(
      transaction,
      organisationId,
      tenderId,
    );
    if (authority.denials.length > 0)
      throw new FinalReadinessError(
        "FINAL_READINESS_PREREQUISITES_NOT_CURRENT",
        "Current final-readiness prerequisites are not satisfied.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const {
      checklist,
      decision,
      draft,
      earlyRisk,
      eligibility,
      extraction,
      tender,
      version,
    } = authority;
    if (
      checklist === null ||
      decision === null ||
      draft === null ||
      earlyRisk === null ||
      eligibility === null ||
      extraction === null ||
      tender === null ||
      version === null
    )
      throw new FinalReadinessError(
        "FINAL_READINESS_PREREQUISITES_NOT_CURRENT",
        "Current final-readiness prerequisites are not satisfied.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const canonical = normaliseFinalReadinessFingerprintInput({
      checklistFingerprint: checklist.sourceFingerprint,
      checklistRunId: checklist.id,
      consolidatedDraftFingerprint: draft.version.sourceFingerprint,
      consolidatedDraftId: draft.id,
      consolidatedDraftVersionId: draft.version.id,
      documents: authority.documents.map(({ id, role, sha256 }) => ({
        checksum: sha256,
        id,
        role,
      })),
      earlyRiskFingerprint: earlyRisk.sourceFingerprint,
      earlyRiskRunId: earlyRisk.id,
      eligibilityRunId: eligibility.id,
      evidenceSnapshotFingerprint: eligibility.snapshot.fingerprint,
      evidenceSnapshotId: eligibility.snapshot.id,
      extractionFingerprint: extraction.sourceFingerprint,
      extractionRunId: extraction.id,
      organisationId,
      policyVersions: [
        FINAL_READINESS_POLICY_VERSION,
        FINAL_READINESS_EXPIRY_POLICY_VERSION,
        FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
      ],
      pursuitDecisionId: decision.id,
      tenderId,
      tenderVersionFingerprint: version.sourceFingerprint,
      tenderVersionId: version.id,
    });
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(canonical))
      .digest("hex");
    const run = await transaction.finalReadinessRun.create({
      data: {
        evidenceExpiryPolicyVersion: FINAL_READINESS_EXPIRY_POLICY_VERSION,
        idempotencyKey,
        inputFingerprint: fingerprint,
        organisationId,
        policyVersion: FINAL_READINESS_POLICY_VERSION,
        requestedByUserId: userId,
        requiredDraftPolicyVersion:
          FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
        tenderId,
        tenderVersionId: version.id,
      },
    });
    const draftApproval = draft.approval;
    if (draftApproval === null)
      throw new FinalReadinessError(
        "FINAL_READINESS_PREREQUISITES_NOT_CURRENT",
        "Current final-readiness prerequisites are not satisfied.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    await transaction.finalReadinessInputSnapshot.create({
      data: {
        checklistGenerationRunId: checklist.id,
        createdByUserId: userId,
        documents: {
          create: authority.documents.map((document) => ({
            checksum: document.sha256,
            corrigendum: document.role === "CORRIGENDUM",
            role: document.role,
            sourceIdentifier: document.id,
            tenderDocumentId: document.id,
          })),
        },
        earlyRiskRunId: earlyRisk.id,
        eligibilityAssessmentRunId: eligibility.id,
        eligibilityInputSnapshotId: eligibility.snapshot.id,
        evidenceExpiryPolicyVersion: FINAL_READINESS_EXPIRY_POLICY_VERSION,
        extractionRunId: extraction.id,
        fingerprint,
        organisationId,
        policyVersion: FINAL_READINESS_POLICY_VERSION,
        pursuitDecisionId: decision.id,
        requiredDraftPolicyVersion:
          FINAL_READINESS_REQUIRED_DRAFT_POLICY_VERSION,
        requiredDrafts: {
          create: {
            draftCreatorUserId: draft.version.createdByUserId,
            draftId: draft.id,
            draftType: "CONSOLIDATED_FIRST_DRAFT",
            draftVersionId: draft.version.id,
            generationRunId: draft.version.generationRunId,
            inputSnapshotId: draft.version.inputSnapshotId,
            qualifyingReviewEventId: draftApproval.id,
            sourceFingerprint: draft.version.sourceFingerprint,
            templateVersionId: draft.version.templateVersionId,
          },
        },
        runId: run.id,
        tenderId,
        tenderVersionId: version.id,
      },
    });
    const finalRiskRun = await transaction.riskAnalysisRun.create({
      data: {
        extractionRunId: extraction.id,
        finalReadinessRunId: run.id,
        gateType: "FINAL_READINESS",
        idempotencyKey: `final-readiness:${run.id}`,
        organisationId,
        publicMessage: "Final readiness risk analysis queued",
        requestedByUserId: userId,
        riskPolicyVersion: FINAL_READINESS_POLICY_VERSION,
        sourceFingerprint: fingerprint,
        tenderId,
        tenderVersionId: version.id,
        triggerType:
          auditEvent === "FINAL_READINESS_RETRIED" ? "RETRY" : "USER",
      },
    });
    await transaction.auditEvent.create({
      data: audit(
        auditEvent,
        organisationId,
        userId,
        run.id,
        "final_readiness_run",
        requestId,
      ),
    });
    return { ...run, finalRiskRunId: finalRiskRun.id };
  }

  private async loadAuthority(
    database: Database,
    organisationId: string,
    tenderId: string,
  ) {
    const tender = await this.loadTender(database, organisationId, tenderId);
    const version = tender?.currentVersion ?? null;
    const [documents, decision, checklist, draft] =
      version === null
        ? ([[], null, null, null] as const)
        : await Promise.all([
            this.loadDocuments(database, organisationId, version.id),
            this.loadDecision(
              database,
              organisationId,
              tenderId,
              version.activeEarlyRiskRunId,
            ),
            this.loadChecklist(database, organisationId, tenderId, version.id),
            this.loadDraft(database, organisationId, tenderId, version.id),
          ]);
    const extraction = version?.activeExtractionRun ?? null;
    const earlyRisk = version?.activeEarlyRiskRun ?? null;
    const eligibility = version?.activeEligibilityAssessmentRun ?? null;
    const scope = (exists: boolean) => ({
      current: exists,
      exists,
      invalidated: false,
      organisationId,
      tenderId,
      tenderVersionId: version?.id ?? "",
    });
    const input: FinalReadinessPrerequisiteInput = {
      organisationId,
      tenderId,
      tenderVersionId: version?.id ?? "",
      tender: {
        current: tender !== null,
        exists: tender !== null,
        invalidated: false,
        organisationId,
        tenderId,
      },
      tenderVersion: scope(version !== null),
      sourceSet: {
        ...scope(documents.length > 0),
        snapshottable: documents.length > 0,
      },
      extraction: {
        ...scope(extraction !== null),
        complete: extraction?.status === "COMPLETE",
        invalidated: extraction?.invalidatedAt !== null && extraction !== null,
      },
      earlyRisk: {
        ...scope(earlyRisk !== null),
        complete: earlyRisk?.status === "COMPLETE",
        gate: earlyRisk?.gateType ?? "EARLY",
        invalidated: earlyRisk?.invalidatedAt !== null && earlyRisk !== null,
      },
      continueDecision: {
        ...scope(decision !== null),
        decision: decision?.decision ?? null,
        earlyRiskRunMatches: decision?.riskAnalysisRunId === earlyRisk?.id,
        superseded: decision?.supersededAt !== null && decision !== null,
      },
      eligibilityAssessment: {
        ...scope(eligibility !== null),
        complete: eligibility?.status === "COMPLETE",
        invalidated:
          eligibility?.invalidatedAt !== null && eligibility !== null,
      },
      evidenceSnapshot: {
        ...scope(eligibility?.snapshot !== undefined && eligibility !== null),
        exactForEligibilityRun:
          eligibility?.snapshotId === eligibility?.snapshot.id,
      },
      checklistGeneration: {
        ...scope(checklist !== null),
        complete: checklist?.status === "COMPLETE",
        eligibilityRunMatches: checklist?.assessmentRunId === eligibility?.id,
        evidenceSnapshotMatches:
          checklist?.evidenceSnapshotId === eligibility?.snapshotId,
        invalidated: checklist?.invalidatedAt !== null && checklist !== null,
      },
      consolidatedDraft: {
        ...scope(draft !== null),
        count: draft === null ? 0 : 1,
        qualified: draft?.qualified ?? false,
        invalidated: draft?.version.invalidatedAt !== null && draft !== null,
      },
    };
    return {
      checklist,
      decision,
      denials: evaluateFinalReadinessPrerequisites(input),
      documents: [...documents],
      draft,
      earlyRisk,
      eligibility,
      extraction,
      tender,
      version,
    };
  }

  private loadTender(
    database: Database,
    organisationId: string,
    tenderId: string,
  ) {
    return database.tender.findFirst({
      include: {
        currentVersion: {
          include: {
            activeEarlyRiskRun: true,
            activeEligibilityAssessmentRun: { include: { snapshot: true } },
            activeExtractionRun: true,
          },
        },
      },
      where: { deletedAt: null, id: tenderId, organisationId },
    });
  }

  private loadDocuments(
    database: Database,
    organisationId: string,
    versionId: string,
  ) {
    return database.tenderDocument.findMany({
      orderBy: { id: "asc" },
      select: { id: true, role: true, sha256: true },
      where: {
        deletedAt: null,
        organisationId,
        status: "READY",
        tenderVersionId: versionId,
      },
    });
  }

  private loadDecision(
    database: Database,
    organisationId: string,
    tenderId: string,
    riskId: string | null,
  ) {
    return riskId === null
      ? Promise.resolve(null)
      : database.earlyPursuitDecision.findFirst({
          where: {
            decision: "CONTINUE",
            organisationId,
            riskAnalysisRunId: riskId,
            supersededAt: null,
            tenderId,
          },
        });
  }

  private loadChecklist(
    database: Database,
    organisationId: string,
    tenderId: string,
    versionId: string,
  ) {
    return database.checklistGenerationRun.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        invalidatedAt: null,
        organisationId,
        status: "COMPLETE",
        tenderId,
        tenderVersionId: versionId,
      },
    });
  }

  private async loadDraft(
    database: Database,
    organisationId: string,
    tenderId: string,
    versionId: string,
  ) {
    const drafts = await database.draft.findMany({
      where: {
        currentVersionId: { not: null },
        draftType: "CONSOLIDATED_FIRST_DRAFT",
        lifecycle: "ACTIVE",
        organisationId,
        tenderId,
      },
    });
    if (drafts.length !== 1 || drafts[0]?.currentVersionId === null)
      return null;
    const draft = drafts[0]!;
    const currentVersionId = draft.currentVersionId;
    if (currentVersionId === null) return null;
    const version = (await database.draftVersion.findFirst({
      include: { sections: { include: { claims: true, placeholders: true } } },
      where: {
        id: currentVersionId,
        organisationId,
        tenderId,
        tenderVersionId: versionId,
      },
    })) as DraftVersionWithSections | null;
    if (version === null) return null;
    const [approval, template, generation] = await Promise.all([
      database.draftReviewEvent.findFirst({
        orderBy: { eventSequence: "desc" },
        where: {
          action: "APPROVE_VERSION",
          draftVersionId: version.id,
          organisationId,
          tenderId,
        },
      }),
      database.draftTemplateVersion.findUnique({
        where: { id: version.templateVersionId },
      }),
      version.generationRunId === null
        ? Promise.resolve(null)
        : database.draftGenerationRun.findUnique({
            where: { id: version.generationRunId },
          }),
    ]);
    const qualified =
      consolidatedDraftQualificationDenials({
        approved: version.reviewState === "APPROVED" && approval !== null,
        approverRoleAtApproval: tenantRole(approval?.actorRoleAtAction ?? null),
        approverUserId: approval?.actorUserId ?? null,
        conflictingMaterialClaims: version.sections.flatMap(({ claims }) =>
          claims.filter(
            ({ material, supportState }) =>
              material && supportState === "CONFLICTING",
          ),
        ).length,
        creatorUserId: version.createdByUserId,
        draftType: draft.draftType,
        expiredMaterialClaims: 0,
        invalidated: version.invalidatedAt !== null,
        isCurrentVersion: draft.currentVersionId === version.id,
        materialClaimsRequiringHumanReview: version.sections.flatMap(
          ({ claims }) =>
            claims.filter(
              ({ material, reviewState }) =>
                material && reviewState !== "APPROVED",
            ),
        ).length,
        requiredReviewerRole: decisionRole(template?.requiredReviewRole),
        sourceFingerprintCurrent:
          generation !== null &&
          generation.invalidatedAt === null &&
          generation.sourceFingerprint === version.sourceFingerprint,
        superseded: version.reviewState === "SUPERSEDED",
        unreviewedMaterialCommitments: version.sections.flatMap(({ claims }) =>
          claims.filter(
            ({ claimClass, material, reviewState }) =>
              material &&
              claimClass === "HUMAN_AUTHORED_COMMITMENT" &&
              reviewState !== "APPROVED",
          ),
        ).length,
        unresolvedApprovalBlockingPlaceholders: version.sections.flatMap(
          ({ placeholders }) =>
            placeholders.filter(
              ({ approvalBlocking, resolutionState }) =>
                approvalBlocking && resolutionState !== "RESOLVED",
            ),
        ).length,
        unsupportedMaterialClaims: version.sections.flatMap(({ claims }) =>
          claims.filter(
            ({ material, supportState }) =>
              material &&
              supportState !== "SUPPORTED" &&
              supportState !== "CONFLICTING",
          ),
        ).length,
        unvalidatedHumanEditedSections: version.sections.filter(
          ({ contentOrigin, reviewState }) =>
            contentOrigin === "HUMAN_EDITED" && reviewState !== "APPROVED",
        ).length,
      }).length === 0;
    return { ...draft, approval, qualified, version };
  }

  private requireRun(organisationId: string, tenderId: string, runId: string) {
    return this.database.finalReadinessRun
      .findFirst({ where: { id: runId, organisationId, tenderId } })
      .then((run) => {
        if (run === null) throw new NotFoundException();
        return run;
      });
  }

  private async requireFresh(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<void> {
    const state = await this.freshness.evaluate(
      organisationId,
      tenderId,
      runId,
    );
    if (!state.fresh)
      throw new FinalReadinessError(
        state.reasons.includes("RUN_INVALIDATED")
          ? "FINAL_READINESS_RUN_INVALIDATED"
          : "FINAL_READINESS_RUN_STALE",
        "The final-readiness run is no longer current.",
        HttpStatus.CONFLICT,
      );
  }

  private startResponse(run: {
    id: string;
    createdAt: Date;
    status: string;
    finalRiskRun?: { id: string } | null;
    finalRiskRunId?: string;
  }) {
    const finalRiskRunId = run.finalRiskRunId ?? run.finalRiskRun?.id;
    if (finalRiskRunId === undefined)
      throw new FinalReadinessError(
        "FINAL_READINESS_SOURCE_INVALID",
        "The linked final-risk record is unavailable.",
        HttpStatus.CONFLICT,
      );
    return {
      created_at: run.createdAt.toISOString(),
      events_path: `/final-readiness/${run.id}/events`,
      final_risk_run_id: finalRiskRunId,
      policy_version: FINAL_READINESS_POLICY_VERSION,
      polling_path: `/final-readiness/${run.id}`,
      run_id: run.id,
      status: run.status,
    };
  }
}

type FinalReadinessAuditEvent =
  | "FINAL_READINESS_CANCELLED"
  | "FINAL_READINESS_DECISION_RECORDED"
  | "FINAL_READINESS_FINDING_REVIEWED"
  | "FINAL_READINESS_DISPOSITION_RECORDED"
  | "FINAL_READINESS_DISPOSITION_SUPERSEDED"
  | "FINAL_READINESS_RETRIED"
  | "FINAL_READINESS_STARTED";

function audit(
  eventType: FinalReadinessAuditEvent,
  organisationId: string,
  userId: string,
  subjectId: string,
  subjectType: string,
  requestId: string,
) {
  return {
    actorUserId: userId,
    eventType: eventType as never,
    organisationId,
    outcome: "SUCCESS",
    requestId,
    subjectId,
    subjectType,
  };
}

type DraftVersionWithSections = Prisma.DraftVersionGetPayload<{
  include: { sections: { include: { claims: true; placeholders: true } } };
}>;

type FindingWithSafeRelations = Prisma.FinalReadinessFindingGetPayload<{
  include: {
    provenance: true;
    reviews: {
      include: { actor: { select: { displayName: true; id: true } } };
    };
  };
}>;

type RunWithSafeRelations = Prisma.FinalReadinessRunGetPayload<{
  include: {
    decisions: {
      include: { actor: { select: { displayName: true; id: true } } };
    };
    finalRiskRun: true;
    findings: { select: { treatment: true } };
  };
}>;

type DecisionWithActor = Prisma.FinalReadinessDecisionGetPayload<{
  include: { actor: { select: { displayName: true; id: true } } };
}>;

function tenantRole(role: Role | null) {
  return role === "PLATFORM_ADMIN" ? null : role;
}

function decisionRole(
  role: Role | null | undefined,
): "OWNER" | "ADMIN" | "REVIEWER" {
  return role === "OWNER" || role === "ADMIN" || role === "REVIEWER"
    ? role
    : "REVIEWER";
}

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function mapRiskStatus(status: string | undefined): string {
  if (status === "COMPLETE") return "COMPLETED";
  if (status === "ANALYSING" || status === "VALIDATING") return "PROCESSING";
  if (status === "INVALIDATED") return "FAILED";
  return status ?? "QUEUED";
}

function countTreatments(findings: readonly { treatment: string }[]) {
  return {
    blockers: findings.filter(({ treatment }) => treatment === "BLOCKER")
      .length,
    human_disposition_required: findings.filter(
      ({ treatment }) => treatment === "HUMAN_DISPOSITION_REQUIRED",
    ).length,
    informational: findings.filter(
      ({ treatment }) => treatment === "INFORMATIONAL",
    ).length,
    warnings: findings.filter(({ treatment }) => treatment === "WARNING")
      .length,
  };
}

function safeFinding(finding: FindingWithSafeRelations) {
  const latestReview = finding.reviews.reduce<
    (typeof finding.reviews)[number] | null
  >(
    (latest, review) =>
      latest === null || review.reviewVersion > latest.reviewVersion
        ? review
        : latest,
    null,
  );
  return {
    created_at: finding.createdAt.toISOString(),
    explanation: finding.explanation,
    id: finding.id,
    lifecycle_state: finding.lifecycle,
    materiality: finding.materiality,
    provenance: finding.provenance.map((source) => {
      const kind = source.kind;
      const key = provenanceIdKey(kind);
      return { id: source[key as keyof typeof source], source_class: kind };
    }),
    provenance_valid: finding.provenanceValid,
    review_state: finding.reviewState,
    review_summary: {
      acknowledgement_recorded: latestReview?.acknowledgementRecorded ?? false,
      latest_action: latestReview?.action ?? null,
      reviewed_at: latestReview?.createdAt.toISOString() ?? null,
      reviewer:
        latestReview === null
          ? null
          : {
              display_name: latestReview.actor.displayName,
              user_id: latestReview.actor.id,
            },
    },
    rule_code: finding.ruleCode,
    title: finding.title,
    treatment: finding.treatment,
  };
}

function runResponse(run: RunWithSafeRelations, fresh: boolean) {
  const decision = run.decisions[0] ?? null;
  return {
    created_at: run.createdAt.toISOString(),
    current_disposition: decision === null ? null : decisionResponse(decision),
    failure_code: run.safeFailureCode ?? run.invalidationCode,
    final_risk_run_id: run.finalRiskRun!.id,
    final_risk_status: mapRiskStatus(run.finalRiskRun?.status),
    finding_counts: countTreatments(run.findings),
    id: run.id,
    invalidated: run.invalidatedAt !== null || run.status === "INVALIDATED",
    is_current: fresh,
    policy_version: run.policyVersion,
    stale: !fresh,
    status: run.status === "INVALIDATED" ? "FAILED" : run.status,
    tender_version_id: run.tenderVersionId,
    updated_at: run.updatedAt.toISOString(),
  };
}

function decisionResponse(decision: DecisionWithActor) {
  return {
    actor: {
      display_name: decision.actor.displayName,
      user_id: decision.actor.id,
    },
    created_at: decision.createdAt.toISOString(),
    disposition: decision.disposition,
    id: decision.id,
    rationale: decision.rationale,
    run_id: decision.runId,
    superseded: decision.supersededAt !== null,
    superseded_at: decision.supersededAt?.toISOString() ?? null,
  };
}

function reviewResponse(
  review: Prisma.FinalReadinessFindingReviewGetPayload<{
    include: { actor: { select: { displayName: true; id: true } } };
  }>,
) {
  return {
    acknowledgement_recorded: review.acknowledgementRecorded,
    action: review.action,
    actor: { display_name: review.actor.displayName, user_id: review.actor.id },
    created_at: review.createdAt.toISOString(),
    finding_id: review.findingId,
    id: review.id,
    rationale: review.rationale,
    review_version: review.reviewVersion,
  };
}

function provenanceIdKey(kind: string): string {
  const keys: Record<string, string> = {
    CHECKLIST_ITEM: "checklistItemId",
    DRAFT_CITATION: "draftCitationId",
    DRAFT_CLAIM: "draftClaimId",
    DRAFT_PLACEHOLDER: "draftPlaceholderId",
    DRAFT_VERSION: "draftVersionId",
    ELIGIBILITY_ASSESSMENT: "eligibilityAssessmentId",
    EVIDENCE_CITATION: "evidenceCitationId",
    EVIDENCE_FACT_VERSION: "evidenceFactVersionId",
    EXTRACTION_CITATION: "extractionCitationId",
    HUMAN_REVIEW_RECORD: "draftReviewEventId",
    RISK_FINDING: "riskFindingId",
  };
  return keys[kind] ?? "id";
}

function dispositionError(denials: readonly string[]): FinalReadinessError {
  const separation = denials.some((reason) => reason.includes("CANNOT_DECIDE"));
  const incomplete = denials.includes("READINESS_RUN_NOT_COMPLETE");
  const finalRisk = denials.includes("FINAL_RISK_RUN_NOT_COMPLETE");
  const invalidated = denials.includes("READINESS_RUN_INVALIDATED");
  return new FinalReadinessError(
    separation
      ? "FINAL_READINESS_SEPARATION_OF_DUTIES_REQUIRED"
      : incomplete
        ? "FINAL_READINESS_RUN_NOT_COMPLETE"
        : finalRisk
          ? "FINAL_READINESS_FINAL_RISK_NOT_COMPLETE"
          : invalidated
            ? "FINAL_READINESS_RUN_INVALIDATED"
            : "FINAL_READINESS_DECISION_BLOCKED",
    separation
      ? "An independent eligible reviewer is required."
      : "The final-readiness decision is blocked by current policy.",
    HttpStatus.CONFLICT,
  );
}
