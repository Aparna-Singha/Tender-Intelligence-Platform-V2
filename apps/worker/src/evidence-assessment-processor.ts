import { Prisma, type PrismaClient } from "@tender/database";
import type { TenderWorkflowProgressJob } from "@tender/contracts";
import {
  EVIDENCE_COMPARISON_POLICY_VERSION,
  dateOnlyExpiryInstant,
  isDateOnlyExpired,
  proposeEligibilityAssessment,
  selectSubmissionDeadline,
  type AssessmentProposal,
  type ComparisonEvidence,
} from "@tender/domain";

export interface EvidenceAssessmentJob {
  readonly assessmentRunId: string;
  readonly organisationId: string;
  readonly requestId: string;
}

export class EvidenceAssessmentProcessor {
  public constructor(private readonly database: PrismaClient) {}

  public async process(
    job: EvidenceAssessmentJob,
    signal: AbortSignal,
  ): Promise<TenderWorkflowProgressJob | null> {
    const run = await this.database.eligibilityAssessmentRun.findFirst({
      include: {
        snapshot: {
          include: {
            documents: true,
            documentReadiness: true,
            evidenceCitations: true,
            evidenceFacts: {
              include: {
                evidenceFactVersion: {
                  include: { citations: true, evidenceFact: true },
                },
              },
            },
            profileValues: true,
            turnoverRecords: true,
          },
        },
      },
      where: { id: job.assessmentRunId, organisationId: job.organisationId },
    });
    if (run === null) throw new Error("ASSESSMENT_RUN_NOT_FOUND");
    if (run.status === "COMPLETE" || run.status === "INVALIDATED") return null;
    await this.checkpoint(
      run.id,
      signal,
      "SNAPSHOTTING",
      15,
      "Validating immutable evidence snapshot",
    );

    const current = await this.database.tenderVersion.findFirst({
      include: { activeEarlyRiskRun: true, activeExtractionRun: true },
      where: {
        activeEarlyRiskRunId: run.riskAnalysisRunId,
        activeExtractionRunId: run.extractionRunId,
        id: run.tenderVersionId,
        tender: {
          currentVersionId: run.tenderVersionId,
          id: run.tenderId,
          organisationId: run.organisationId,
        },
      },
    });
    const decision = await this.database.earlyPursuitDecision.findFirst({
      where: {
        decision: "CONTINUE",
        id: run.pursuitDecisionId,
        organisationId: run.organisationId,
        riskAnalysisRunId: run.riskAnalysisRunId,
        supersededAt: null,
        tenderVersionId: run.tenderVersionId,
      },
    });
    if (
      current?.activeExtractionRun?.status !== "COMPLETE" ||
      current.activeExtractionRun.invalidatedAt !== null ||
      current.activeEarlyRiskRun?.status !== "COMPLETE" ||
      current.activeEarlyRiskRun.invalidatedAt !== null ||
      decision === null
    ) {
      await this.invalidate(run.id);
      return null;
    }

    const requirements = await this.database.structuredRequirement.findMany({
      include: { citations: { where: { validationStatus: "VALID" } } },
      orderBy: { createdAt: "asc" },
      where: {
        extractionRunId: run.extractionRunId,
        supersededBy: { none: {} },
        reviewState: { not: "REJECTED" },
      },
    });
    if (
      requirements.length > 2_000 ||
      requirements.some((requirement) => requirement.citations.length === 0)
    )
      throw new Error("TENDER_CITATION_VALIDATION_FAILED");

    const closingDates = await this.database.extractedTenderField.findMany({
      include: { citations: { include: { tenderDocument: true } } },
      where: {
        extractionRunId: run.extractionRunId,
        fieldType: "SUBMISSION_DEADLINE",
      },
    });
    const deadline = selectSubmissionDeadline(closingDates);
    const evaluationDate = deadline.date ?? new Date();

    await this.checkpoint(
      run.id,
      signal,
      "MATCHING",
      45,
      "Matching authorised structured evidence",
    );
    const sourceIds = [
      ...new Set([
        ...run.snapshot.documents.map((item) => item.documentId),
        ...run.snapshot.evidenceFacts.map(
          (item) => item.evidenceFactVersion.evidenceFact.documentId,
        ),
        ...run.snapshot.profileValues.flatMap((item) =>
          item.evidenceDocumentId ? [item.evidenceDocumentId] : [],
        ),
        ...run.snapshot.turnoverRecords.flatMap((item) =>
          item.evidenceDocumentId ? [item.evidenceDocumentId] : [],
        ),
        ...run.snapshot.documentReadiness.flatMap((item) =>
          item.evidenceDocumentId ? [item.evidenceDocumentId] : [],
        ),
      ]),
    ];
    const sourceDocuments =
      sourceIds.length === 0
        ? []
        : await this.database.document.findMany({
            include: { currentVersion: true },
            where: {
              id: { in: sourceIds },
              organisationId: run.organisationId,
            },
          });
    const sourceById = new Map(sourceDocuments.map((item) => [item.id, item]));
    const snapshotEvidence = buildEvidence(
      run.snapshot,
      evaluationDate,
      sourceById,
    );
    const rows: Prisma.EligibilityAssessmentCreateManyInput[] =
      requirements.map((requirement) => {
        const relevant = snapshotEvidence.filter((item) =>
          isRelevant(
            requirement.category,
            item.factType,
            requirement.sourceWording,
          ),
        );
        const requirementInput = {
          category: requirement.category,
          confidence: requirement.confidence,
          findingState: requirement.findingState,
          obligation: requirement.obligation,
          sourceWording: requirement.sourceWording,
          tenderCitationIds: requirement.citations.map(
            (citation) => citation.id,
          ),
          ...(requirement.thresholdNumericValue === null
            ? {}
            : {
                threshold: {
                  ...(requirement.currency === null
                    ? {}
                    : { currency: requirement.currency }),
                  operator: requirement.thresholdOperator ?? "=",
                  ...(requirement.unit === null
                    ? {}
                    : { unit: requirement.unit }),
                  value: requirement.thresholdNumericValue.toNumber(),
                },
              }),
        } as const;
        const proposal: AssessmentProposal =
          deadline.date === null &&
          relevant.some((item) => item.expiresAt !== undefined)
            ? {
                confidence: 0,
                directEvidenceIndexes: [],
                policyRule: "SUBMISSION_DEADLINE_UNRESOLVED",
                rationale: deadline.conflicting
                  ? "Conflicting cited submission deadlines prevent assessment of evidence validity at submission."
                  : "No authoritative submission deadline is available to assess evidence validity at submission.",
                state: "HUMAN_REVIEW_REQUIRED",
                uncertainty:
                  "An authorised reviewer must establish the submission deadline before comparing expiring evidence.",
              }
            : proposeEligibilityAssessment(
                requirementInput,
                relevant,
                evaluationDate,
              );
        return {
          assessmentRunId: run.id,
          comparisonPolicyRule: proposal.policyRule,
          currentState: proposal.state,
          organisationId: run.organisationId,
          policyVersion: EVIDENCE_COMPARISON_POLICY_VERSION,
          proposedConfidence: proposal.confidence,
          proposedRationale: proposal.rationale,
          proposedState: proposal.state,
          requirementCategory: requirement.category,
          requirementObligation: requirement.obligation,
          structuredRequirementId: requirement.id,
          tenderCitationId: requirement.citations[0]?.id ?? "",
          tenderId: run.tenderId,
          tenderVersionId: run.tenderVersionId,
          uncertainty: proposal.uncertainty,
        };
      });

    await this.checkpoint(
      run.id,
      signal,
      "VALIDATING",
      75,
      "Validating evidence links and citations",
    );
    await this.database.$transaction(
      async (transaction) => {
        await assertSourcesUnchanged(
          transaction,
          run.snapshot,
          sourceById,
          sourceIds,
        );
        const downstreamInvalidatedAt = new Date();
        await transaction.eligibilityAssessment.deleteMany({
          where: { assessmentRunId: run.id },
        });
        if (rows.length > 0)
          await transaction.eligibilityAssessment.createMany({ data: rows });
        const assessments = await transaction.eligibilityAssessment.findMany({
          where: { assessmentRunId: run.id },
        });
        const factVersions = run.snapshot.evidenceFacts.map(
          (item) => item.evidenceFactVersion,
        );
        const requirementById = new Map(
          requirements.map((requirement) => [requirement.id, requirement]),
        );
        const snapshotCitationIds = new Set(
          run.snapshot.evidenceCitations.map(
            (citation) => citation.sourceEvidenceCitationId,
          ),
        );
        const links: Prisma.EligibilityAssessmentEvidenceLinkCreateManyInput[] =
          assessments.flatMap((assessment) =>
            factVersions
              .filter((fact) =>
                isRelevant(
                  assessment.requirementCategory,
                  fact.evidenceFact.factType,
                  requirementById.get(assessment.structuredRequirementId)
                    ?.sourceWording ?? "",
                ),
              )
              .slice(0, 20)
              .map((fact) => {
                const citation = fact.citations.find(
                  (candidate) =>
                    snapshotCitationIds.has(candidate.id) &&
                    candidate.invalidatedAt === null &&
                    candidate.validationStatus === "VALID",
                );
                const source = sourceById.get(fact.evidenceFact.documentId);
                const recorded = run.snapshot.documents.find(
                  (item) => item.documentId === fact.evidenceFact.documentId,
                );
                const direct =
                  fact.reviewState === "ACCEPTED" &&
                  fact.evidenceFact.currentVersionId === fact.id &&
                  recorded?.documentVersionId === fact.documentVersionId &&
                  citation?.documentId === fact.evidenceFact.documentId &&
                  citation.documentChecksum === recorded.checksum &&
                  sourceIsCurrent(
                    source,
                    fact.documentVersionId,
                    citation.documentChecksum,
                    evaluationDate,
                  ) &&
                  citation.documentVersionId === fact.documentVersionId;
                const conflict =
                  fact.evidenceFact.factType.endsWith("_CONFLICT");
                return {
                  assessmentId: assessment.id,
                  evidenceCitationId: citation?.id ?? null,
                  evidenceFactVersionId: fact.id,
                  linkType: conflict
                    ? "CONTRADICTS"
                    : direct
                      ? "DIRECT_SUPPORT"
                      : "PARTIAL_SUPPORT",
                  relevance: conflict || direct ? 1 : 0.6,
                  scope: fact.scope,
                };
              }),
          );
        if (links.length > 0)
          await transaction.eligibilityAssessmentEvidenceLink.createMany({
            data: links,
            skipDuplicates: true,
          });
        const fresh = await transaction.eligibilityAssessmentRun.findUnique({
          where: { id: run.id },
        });
        if (
          fresh?.cancellationRequestedAt !== null ||
          fresh.status === "INVALIDATED"
        )
          throw new Error("ASSESSMENT_CANCELLED_OR_INVALIDATED");
        await transaction.eligibilityAssessmentRun.update({
          data: {
            completedAt: new Date(),
            currentStage: "COMPLETE",
            eventSequence: { increment: 1 },
            progressPercentage: 100,
            publicMessage:
              "Evidence comparison complete; human review remains required",
            status: "COMPLETE",
          },
          where: { id: run.id },
        });
        await transaction.tenderVersion.update({
          data: { activeEligibilityAssessmentRunId: run.id },
          where: { id: run.tenderVersionId },
        });
        await transaction.checklistGenerationRun.updateMany({
          data: {
            activatedAt: null,
            currentStage: "INVALIDATED",
            invalidatedAt: downstreamInvalidatedAt,
            publicMessage: "A newer Phase 7 assessment became current",
            status: "INVALIDATED",
          },
          where: {
            assessmentRunId: { not: run.id },
            invalidatedAt: null,
            organisationId: run.organisationId,
            tenderId: run.tenderId,
            tenderVersionId: run.tenderVersionId,
          },
        });
        await transaction.checklistItem.updateMany({
          data: {
            invalidatedAt: downstreamInvalidatedAt,
            status: "INVALIDATED",
          },
          where: {
            generationRun: {
              assessmentRunId: { not: run.id },
              organisationId: run.organisationId,
              tenderId: run.tenderId,
              tenderVersionId: run.tenderVersionId,
            },
            invalidatedAt: null,
          },
        });
        await transaction.auditEvent.create({
          data: {
            eventType: "ELIGIBILITY_ASSESSMENT_ACTIVATED",
            organisationId: run.organisationId,
            outcome: "SUCCESS",
            requestId: job.requestId,
            subjectId: run.id,
            subjectType: "eligibility_assessment_run",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return {
      organisationId: job.organisationId,
      requestId: job.requestId,
      tenderId: run.tenderId,
      triggerId: run.id,
      triggerType: "ELIGIBILITY_COMPLETE",
      userId: run.requestedByUserId,
    };
  }

  public async fail(runId: string, category: string): Promise<void> {
    const run = await this.database.eligibilityAssessmentRun.findUnique({
      select: { cancellationRequestedAt: true },
      where: { id: runId },
    });
    await this.database.eligibilityAssessmentRun.updateMany({
      data: {
        currentStage:
          run?.cancellationRequestedAt === null ? "FAILED" : "CANCELLED",
        failureCategory:
          run?.cancellationRequestedAt === null ? category.slice(0, 80) : null,
        internalFailureReference:
          run?.cancellationRequestedAt === null ? crypto.randomUUID() : null,
        publicMessage:
          run?.cancellationRequestedAt === null
            ? "Evidence comparison failed safely"
            : "Evidence comparison cancelled",
        safeFailureMessage:
          run?.cancellationRequestedAt === null
            ? "Evidence comparison could not be completed"
            : null,
        status: run?.cancellationRequestedAt === null ? "FAILED" : "CANCELLED",
      },
      where: {
        id: runId,
        status: { in: ["QUEUED", "SNAPSHOTTING", "MATCHING", "VALIDATING"] },
      },
    });
  }

  private async checkpoint(
    runId: string,
    signal: AbortSignal,
    stage: "SNAPSHOTTING" | "MATCHING" | "VALIDATING",
    progress: number,
    message: string,
  ): Promise<void> {
    if (signal.aborted) throw new Error("ASSESSMENT_TIMEOUT");
    const result = await this.database.eligibilityAssessmentRun.updateMany({
      data: {
        currentStage: stage,
        eventSequence: { increment: 1 },
        progressPercentage: progress,
        publicMessage: message,
        ...(stage === "SNAPSHOTTING" ? { startedAt: new Date() } : {}),
        status: stage,
      },
      where: {
        cancellationRequestedAt: null,
        id: runId,
        invalidatedAt: null,
        status: { in: ["QUEUED", "SNAPSHOTTING", "MATCHING", "VALIDATING"] },
      },
    });
    if (result.count !== 1)
      throw new Error("ASSESSMENT_CANCELLED_OR_INVALIDATED");
  }

  private async invalidate(runId: string): Promise<void> {
    await this.database.eligibilityAssessmentRun.updateMany({
      data: {
        currentStage: "INVALIDATED",
        invalidatedAt: new Date(),
        publicMessage: "Authoritative inputs changed",
        status: "INVALIDATED",
      },
      where: {
        id: runId,
        status: { notIn: ["FAILED", "CANCELLED", "INVALIDATED"] },
      },
    });
  }
}

type Snapshot = Prisma.EligibilityInputSnapshotGetPayload<{
  include: {
    documents: true;
    documentReadiness: true;
    evidenceCitations: true;
    evidenceFacts: {
      include: {
        evidenceFactVersion: {
          include: { citations: true; evidenceFact: true };
        };
      };
    };
    profileValues: true;
    turnoverRecords: true;
  };
}>;

type SourceDocument = Prisma.DocumentGetPayload<{
  include: { currentVersion: true };
}>;

export async function assertSourcesUnchanged(
  transaction: Prisma.TransactionClient,
  snapshot: Snapshot,
  originalSources: ReadonlyMap<string, SourceDocument>,
  sourceIds: readonly string[],
): Promise<void> {
  const facts = snapshot.evidenceFacts.map((item) => item.evidenceFactVersion);
  const lockGroups: readonly [string, readonly string[]][] = [
    ["documents", sourceIds],
    ["company_evidence_facts", facts.map((item) => item.evidenceFactId)],
    ["company_evidence_fact_versions", facts.map((item) => item.id)],
    [
      "company_evidence_citations",
      facts.flatMap((item) => item.citations.map((citation) => citation.id)),
    ],
  ];
  for (const [table, identifiers] of lockGroups) {
    const ids = [...new Set(identifiers)].sort();
    if (ids.length === 0) continue;
    await transaction.$queryRaw(
      Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`,
    );
  }
  if (sourceIds.length > 0) {
    const fresh = await transaction.document.findMany({
      include: { currentVersion: true },
      where: {
        id: { in: [...sourceIds] },
        organisationId: snapshot.organisationId,
      },
    });
    if (
      fresh.length !== originalSources.size ||
      fresh.some((source) => {
        const original = originalSources.get(source.id);
        return (
          source.status !== original?.status ||
          source.deletedAt?.getTime() !== original.deletedAt?.getTime() ||
          source.currentVersionId !== original.currentVersionId ||
          source.currentVersion?.sha256 !== original.currentVersion?.sha256 ||
          source.expiryDate?.getTime() !== original.expiryDate?.getTime()
        );
      })
    )
      throw new Error("ASSESSMENT_SOURCE_CHANGED");
  }
  if (facts.length > 0) {
    const fresh = await transaction.companyEvidenceFactVersion.findMany({
      include: { citations: true, evidenceFact: true },
      where: { id: { in: facts.map((item) => item.id) } },
    });
    const freshById = new Map(fresh.map((item) => [item.id, item]));
    if (
      fresh.length !== facts.length ||
      facts.some((original) => {
        const current = freshById.get(original.id);
        if (
          current?.reviewState !== original.reviewState ||
          current.documentVersionId !== original.documentVersionId ||
          current.evidenceFact.currentVersionId !==
            original.evidenceFact.currentVersionId ||
          current.evidenceFact.invalidatedAt?.getTime() !==
            original.evidenceFact.invalidatedAt?.getTime() ||
          current.citations.length !== original.citations.length
        )
          return true;
        const citations = new Map(
          current.citations.map((item) => [item.id, item]),
        );
        return original.citations.some((citation) => {
          const now = citations.get(citation.id);
          return (
            now?.validationStatus !== citation.validationStatus ||
            now.invalidatedAt?.getTime() !==
              citation.invalidatedAt?.getTime() ||
            now.documentVersionId !== citation.documentVersionId ||
            now.documentChecksum !== citation.documentChecksum
          );
        });
      })
    )
      throw new Error("ASSESSMENT_SOURCE_CHANGED");
  }
}

function sourceIsReady(source: SourceDocument | undefined): boolean {
  return source?.status === "READY" && source.deletedAt === null;
}

function sourceIsCurrent(
  source: SourceDocument | undefined,
  versionId: string,
  checksum: string,
  evaluationDate: Date,
): boolean {
  return (
    sourceIsReady(source) &&
    source?.currentVersionId === versionId &&
    source.currentVersion?.sha256 === checksum &&
    (source.expiryDate === null ||
      !isDateOnlyExpired(source.expiryDate, evaluationDate))
  );
}

function validThroughDate(date: Date): Date {
  return new Date(dateOnlyExpiryInstant(date).getTime() - 1);
}

function earliestExpiry(first: Date | null, second: Date | null): Date | null {
  if (first === null) return second;
  if (second === null) return first;
  return first < second ? first : second;
}

export function buildEvidence(
  snapshot: Snapshot,
  evaluationDate: Date,
  sourceById: ReadonlyMap<string, SourceDocument>,
): readonly ComparisonEvidence[] {
  const snapshotCitationIds = new Set(
    snapshot.evidenceCitations.map(
      (citation) => citation.sourceEvidenceCitationId,
    ),
  );
  const snapshotDocumentById = new Map(
    snapshot.documents.map((item) => [item.documentId, item]),
  );
  const profileSource = (
    documentId: string | null,
    verificationStatus: string,
  ): boolean => {
    if (documentId === null) return verificationStatus !== "DOCUMENT_VERIFIED";
    const recorded = snapshotDocumentById.get(documentId);
    return (
      recorded !== undefined &&
      sourceIsCurrent(
        sourceById.get(documentId),
        recorded.documentVersionId,
        recorded.checksum,
        evaluationDate,
      )
    );
  };
  return [
    ...snapshot.profileValues.map((item) => ({
      confidence: item.verificationStatus === "DOCUMENT_VERIFIED" ? 0.8 : 0.5,
      documentCurrent: profileSource(
        item.evidenceDocumentId,
        item.verificationStatus,
      ),
      documentReady: profileSource(
        item.evidenceDocumentId,
        item.verificationStatus,
      ),
      documentVerified: item.verificationStatus === "DOCUMENT_VERIFIED",
      factType: item.fieldKey,
      sourceKind: "PROFILE" as const,
      value:
        item.textValue ??
        item.numberValue?.toNumber() ??
        item.booleanValue ??
        item.dateValue ??
        item.textListValue,
      verificationStatus: item.verificationStatus,
    })),
    ...snapshot.turnoverRecords.map((item) => ({
      confidence: item.verificationStatus === "DOCUMENT_VERIFIED" ? 0.8 : 0.5,
      documentCurrent: profileSource(
        item.evidenceDocumentId,
        item.verificationStatus,
      ),
      documentReady: profileSource(
        item.evidenceDocumentId,
        item.verificationStatus,
      ),
      documentVerified: item.verificationStatus === "DOCUMENT_VERIFIED",
      factType: "TURNOVER",
      sourceKind: "TURNOVER" as const,
      value: item.amountInr.toNumber(),
      valueUnit: "INR",
      verificationStatus: item.verificationStatus,
    })),
    ...snapshot.documents.map((item) => ({
      confidence: 0.4,
      documentCurrent: sourceIsCurrent(
        sourceById.get(item.documentId),
        item.documentVersionId,
        item.checksum,
        evaluationDate,
      ),
      documentReady: sourceIsReady(sourceById.get(item.documentId)),
      documentVerified: item.verificationStatus === "VERIFIED",
      ...(item.expiryDate === null
        ? {}
        : { expiresAt: validThroughDate(item.expiryDate) }),
      factType: item.category,
      sourceKind: "DOCUMENT_METADATA" as const,
      verificationStatus:
        item.expiryDate !== null &&
        validThroughDate(item.expiryDate) < evaluationDate
          ? "EXPIRED"
          : item.verificationStatus,
    })),
    ...snapshot.documentReadiness.map((item) => ({
      confidence: item.verificationStatus === "DOCUMENT_VERIFIED" ? 0.7 : 0.4,
      documentCurrent: profileSource(
        item.evidenceDocumentId,
        item.verificationStatus,
      ),
      documentReady:
        item.readinessStatus === "AVAILABLE" &&
        profileSource(item.evidenceDocumentId, item.verificationStatus),
      documentVerified: item.verificationStatus === "DOCUMENT_VERIFIED",
      ...(item.expectedExpiry === null
        ? {}
        : { expiresAt: validThroughDate(item.expectedExpiry) }),
      factType: item.documentType,
      sourceKind: "DOCUMENT_METADATA" as const,
      verificationStatus:
        item.readinessStatus === "MISSING"
          ? "MISSING"
          : item.verificationStatus,
    })),
    ...snapshot.evidenceFacts.map(({ evidenceFactVersion: item }) => {
      const source = sourceById.get(item.evidenceFact.documentId);
      const recorded = snapshotDocumentById.get(item.evidenceFact.documentId);
      const citation = item.citations.find(
        (candidate) =>
          snapshotCitationIds.has(candidate.id) &&
          candidate.invalidatedAt === null &&
          candidate.validationStatus === "VALID" &&
          candidate.documentVersionId === item.documentVersionId &&
          candidate.documentId === item.evidenceFact.documentId &&
          recorded?.documentVersionId === item.documentVersionId &&
          recorded.checksum === candidate.documentChecksum,
      );
      const current =
        item.evidenceFact.currentVersionId === item.id &&
        item.evidenceFact.invalidatedAt === null &&
        recorded !== undefined &&
        sourceIsCurrent(
          source,
          recorded.documentVersionId,
          recorded.checksum,
          evaluationDate,
        );
      const expiresAt = earliestExpiry(
        item.validUntil,
        source?.expiryDate ?? null,
      );
      return {
        ...(citation === undefined ? {} : { citationId: citation.id }),
        confidence: item.confidence.toNumber(),
        documentCurrent: current,
        documentReady: sourceIsReady(source),
        documentVerified: current && item.reviewState === "ACCEPTED",
        ...(expiresAt === null
          ? {}
          : { expiresAt: validThroughDate(expiresAt) }),
        factType: item.evidenceFact.factType,
        sourceKind: "MANUAL_DOCUMENT_FACT" as const,
        value:
          item.textValue ??
          item.numberValue?.toNumber() ??
          item.booleanValue ??
          item.dateValue ??
          item.textListValue,
        ...(item.unit === null && item.currency === null
          ? {}
          : { valueUnit: item.unit ?? item.currency ?? "" }),
        verificationStatus: item.evidenceFact.factType.endsWith("_CONFLICT")
          ? "CONFLICTING"
          : item.reviewState,
      };
    }),
  ];
}

export function isRelevant(
  category: string,
  factType: string,
  sourceWording = "",
): boolean {
  const left = category.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");
  const right = factType.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");
  const source = sourceWording.toUpperCase();
  if (left.includes("EXPERIENCE"))
    return ["COMPLETEDEXPERIENCEORDERVALUE", "EXPERIENCECERTIFICATE"].some(
      (candidate) => right.includes(candidate),
    );
  if (left.includes("TURNOVER")) return right.includes("TURNOVER3YEARAVERAGE");
  if (left.includes("CERTIFICATION"))
    return right.includes("ISO9001CERTIFICATION");
  if (left.includes("OEMAUTORISATION"))
    return right.includes("OEMAUTORISATION");
  if (left === "OTHER") {
    if (/\b(?:UDYAM|MSME)\b/u.test(source)) return right.includes("UDYAM");
    if (/\bGST\b/u.test(source)) return right.startsWith("GST");
    if (/\b(?:INCORPORATION|CIN)\b/u.test(source))
      return right === "INCORPORATION";
    return false;
  }
  return (
    left.includes(right) ||
    right.includes(left) ||
    (left.includes("TURNOVER") && right.includes("TURNOVER"))
  );
}

export function isEvidenceAssessmentJob(
  value: unknown,
): value is EvidenceAssessmentJob {
  return (
    typeof value === "object" &&
    value !== null &&
    "assessmentRunId" in value &&
    "organisationId" in value &&
    "requestId" in value &&
    typeof value.assessmentRunId === "string" &&
    typeof value.organisationId === "string" &&
    typeof value.requestId === "string"
  );
}
