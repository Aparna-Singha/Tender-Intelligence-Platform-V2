import type { Prisma, PrismaClient } from "@tender/database";
import type { TenderWorkflowProgressJob } from "@tender/contracts";
import {
  EVIDENCE_COMPARISON_POLICY_VERSION,
  proposeEligibilityAssessment,
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

    await this.checkpoint(
      run.id,
      signal,
      "MATCHING",
      45,
      "Matching authorised structured evidence",
    );
    const snapshotEvidence = buildEvidence(run.snapshot);
    const rows: Prisma.EligibilityAssessmentCreateManyInput[] =
      requirements.map((requirement) => {
        const relevant = snapshotEvidence.filter((item) =>
          isRelevant(requirement.category, item.factType),
        );
        const proposal = proposeEligibilityAssessment(
          {
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
          },
          relevant,
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
    await this.database.$transaction(async (transaction) => {
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
              const direct =
                fact.reviewState === "ACCEPTED" && citation !== undefined;
              return {
                assessmentId: assessment.id,
                evidenceCitationId: citation?.id ?? null,
                evidenceFactVersionId: fact.id,
                linkType: direct ? "DIRECT_SUPPORT" : "PARTIAL_SUPPORT",
                relevance: direct ? 1 : 0.6,
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
    });
    return {
      organisationId: job.organisationId,
      requestId: job.requestId,
      tenderId: run.tenderId,
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

function buildEvidence(snapshot: Snapshot): readonly ComparisonEvidence[] {
  const now = new Date();
  const snapshotCitationIds = new Set(
    snapshot.evidenceCitations.map(
      (citation) => citation.sourceEvidenceCitationId,
    ),
  );
  return [
    ...snapshot.profileValues.map((item) => ({
      confidence: item.verificationStatus === "DOCUMENT_VERIFIED" ? 0.8 : 0.5,
      documentCurrent: true,
      documentReady: true,
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
      documentCurrent: true,
      documentReady: true,
      documentVerified: item.verificationStatus === "DOCUMENT_VERIFIED",
      factType: "TURNOVER",
      sourceKind: "TURNOVER" as const,
      value: item.amountInr.toNumber(),
      valueUnit: "INR",
      verificationStatus: item.verificationStatus,
    })),
    ...snapshot.documents.map((item) => ({
      confidence: 0.4,
      documentCurrent: true,
      documentReady: true,
      documentVerified: item.verificationStatus === "VERIFIED",
      ...(item.expiryDate === null ? {} : { expiresAt: item.expiryDate }),
      factType: item.category,
      sourceKind: "DOCUMENT_METADATA" as const,
      verificationStatus:
        item.expiryDate !== null && item.expiryDate < now
          ? "EXPIRED"
          : item.verificationStatus,
    })),
    ...snapshot.documentReadiness.map((item) => ({
      confidence: item.verificationStatus === "DOCUMENT_VERIFIED" ? 0.7 : 0.4,
      documentCurrent: true,
      documentReady: item.readinessStatus === "AVAILABLE",
      documentVerified: item.verificationStatus === "DOCUMENT_VERIFIED",
      ...(item.expectedExpiry === null
        ? {}
        : { expiresAt: item.expectedExpiry }),
      factType: item.documentType,
      sourceKind: "DOCUMENT_METADATA" as const,
      verificationStatus:
        item.readinessStatus === "MISSING"
          ? "MISSING"
          : item.verificationStatus,
    })),
    ...snapshot.evidenceFacts.map(({ evidenceFactVersion: item }) => {
      const citation = item.citations.find(
        (candidate) =>
          snapshotCitationIds.has(candidate.id) &&
          candidate.invalidatedAt === null &&
          candidate.validationStatus === "VALID",
      );
      return {
        ...(citation === undefined ? {} : { citationId: citation.id }),
        confidence: item.confidence.toNumber(),
        documentCurrent: true,
        documentReady: true,
        documentVerified: item.reviewState === "ACCEPTED",
        ...(item.validUntil === null ? {} : { expiresAt: item.validUntil }),
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
        verificationStatus: item.reviewState,
      };
    }),
  ];
}

function isRelevant(category: string, factType: string): boolean {
  const left = category.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");
  const right = factType.toUpperCase().replaceAll(/[^A-Z0-9]/gu, "");
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
