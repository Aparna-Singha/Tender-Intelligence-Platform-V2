import type { PrismaClient } from "@tender/database";
import {
  CHECKLIST_DATE_POLICY_VERSION,
  CHECKLIST_DEDUPLICATION_POLICY_VERSION,
  CHECKLIST_POLICY_VERSION,
  CHECKLIST_PRIORITY_POLICY_VERSION,
  proposeChecklistItem,
} from "@tender/domain";
import { createHash } from "node:crypto";

export interface ChecklistGenerationJob {
  readonly checklistRunId: string;
  readonly organisationId: string;
  readonly requestId: string;
}

export function isChecklistGenerationJob(
  value: unknown,
): value is ChecklistGenerationJob {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.checklistRunId === "string" &&
    typeof item.organisationId === "string" &&
    typeof item.requestId === "string"
  );
}

export class ChecklistGenerationProcessor {
  public constructor(private readonly database: PrismaClient) {}

  public async process(
    job: ChecklistGenerationJob,
    signal: AbortSignal,
  ): Promise<void> {
    const run = await this.database.checklistGenerationRun.findFirst({
      where: { id: job.checklistRunId, organisationId: job.organisationId },
    });
    if (run === null) throw new Error("CHECKLIST_RUN_NOT_FOUND");
    if (run.status === "COMPLETE" || run.status === "INVALIDATED") return;
    await this.checkpoint(run.id, signal, "LOADING_ASSESSMENTS", 20);

    const version = await this.database.tenderVersion.findFirst({
      include: {
        activeEarlyRiskRun: true,
        activeEligibilityAssessmentRun: true,
        activeExtractionRun: true,
      },
      where: {
        id: run.tenderVersionId,
        tender: {
          currentVersionId: run.tenderVersionId,
          id: run.tenderId,
          organisationId: run.organisationId,
        },
      },
    });
    const assessmentRun = version?.activeEligibilityAssessmentRun;
    const decision = await this.database.earlyPursuitDecision.findFirst({
      where: {
        decision: "CONTINUE",
        id: run.pursuitDecisionId,
        organisationId: run.organisationId,
        supersededAt: null,
      },
    });
    if (
      version?.activeExtractionRun?.id !== run.extractionRunId ||
      version.activeExtractionRun.status !== "COMPLETE" ||
      version.activeEarlyRiskRun?.id !== run.riskAnalysisRunId ||
      version.activeEarlyRiskRun.status !== "COMPLETE" ||
      assessmentRun?.id !== run.assessmentRunId ||
      assessmentRun.status !== "COMPLETE" ||
      assessmentRun.invalidatedAt !== null ||
      assessmentRun.snapshotId !== run.evidenceSnapshotId ||
      decision === null
    ) {
      await this.invalidate(run.id);
      return;
    }

    const assessments = await this.database.eligibilityAssessment.findMany({
      include: {
        evidenceLinks: {
          include: {
            evidenceCitation: true,
            evidenceFactVersion: true,
          },
        },
        reviews: { select: { id: true } },
        structuredRequirement: true,
        tenderCitation: true,
      },
      where: {
        assessmentRunId: run.assessmentRunId,
        invalidatedAt: null,
        organisationId: run.organisationId,
        tenderId: run.tenderId,
      },
    });
    if (assessments.length > 2_000)
      throw new Error("CHECKLIST_ASSESSMENT_LIMIT_EXCEEDED");
    await this.checkpoint(run.id, signal, "GENERATING", 45);

    const grouped = new Map<
      string,
      {
        assessmentIds: string[];
        citations: {
          evidenceCitationId?: string;
          extractionCitationId: string;
        }[];
        proposal: NonNullable<ReturnType<typeof proposeChecklistItem>>;
        requirementCategories: string[];
        requirementIds: string[];
      }
    >();
    for (const assessment of assessments) {
      const proposal = proposeChecklistItem({
        assessmentId: assessment.id,
        currentState: assessment.currentState,
        proposedState: assessment.proposedState,
        policyRule: assessment.comparisonPolicyRule,
        requirementCategory: assessment.requirementCategory,
        requirementId: assessment.structuredRequirementId,
        obligation: assessment.requirementObligation,
        sourceCoverageComplete:
          assessment.tenderCitation.validationStatus === "VALID",
        tenderCitationId: assessment.tenderCitationId,
        hasDirectEvidence: assessment.evidenceLinks.some(
          (link) =>
            link.linkType === "DIRECT_SUPPORT" &&
            link.evidenceCitation?.validationStatus === "VALID",
        ),
        hasDocumentMetadata:
          assessment.comparisonPolicyRule === "DOCUMENT_EXISTS_ONLY",
        hasUnverifiedEvidence: assessment.evidenceLinks.some(
          (link) => link.evidenceFactVersion?.reviewState !== "ACCEPTED",
        ),
        hasExpiredEvidence: assessment.evidenceLinks.some(
          (link) =>
            link.evidenceFactVersion?.validUntil !== null &&
            link.evidenceFactVersion?.validUntil !== undefined &&
            link.evidenceFactVersion.validUntil < new Date(),
        ),
        ...(assessment.structuredRequirement.conditionText === null
          ? {}
          : { scope: assessment.structuredRequirement.conditionText }),
      });
      if (proposal === undefined) continue;
      const key = createHash("sha256")
        .update(
          [
            run.organisationId,
            run.tenderVersionId,
            run.assessmentRunId,
            proposal.deduplicationKey,
          ].join("|"),
        )
        .digest("hex");
      const current = grouped.get(key);
      if (current === undefined)
        grouped.set(key, {
          assessmentIds: [assessment.id],
          citations: sourcePairs(assessment),
          proposal,
          requirementCategories: [assessment.requirementCategory],
          requirementIds: [assessment.structuredRequirementId],
        });
      else {
        current.assessmentIds.push(assessment.id);
        current.citations.push(...sourcePairs(assessment));
        current.requirementCategories.push(assessment.requirementCategory);
        current.requirementIds.push(assessment.structuredRequirementId);
      }
    }
    if (grouped.size > 2_000) throw new Error("CHECKLIST_ITEM_LIMIT_EXCEEDED");
    await this.checkpoint(run.id, signal, "DEDUPLICATING", 70);
    await this.checkpoint(run.id, signal, "VALIDATING", 85);

    const outcome = await this.database.$transaction(async (transaction) => {
      const fresh = await transaction.checklistGenerationRun.findFirst({
        where: {
          cancellationRequestedAt: null,
          id: run.id,
          invalidatedAt: null,
          organisationId: run.organisationId,
        },
      });
      if (fresh === null) throw new Error("CHECKLIST_CANCELLED_OR_INVALIDATED");
      const authority = await transaction.tenderVersion.findFirst({
        include: {
          activeEligibilityAssessmentRun: {
            include: {
              assessments: {
                include: {
                  evidenceLinks: { select: { id: true } },
                  reviews: { select: { id: true } },
                },
                orderBy: { id: "asc" },
              },
            },
          },
        },
        where: {
          id: run.tenderVersionId,
          tender: {
            currentVersionId: run.tenderVersionId,
            id: run.tenderId,
            organisationId: run.organisationId,
          },
        },
      });
      const authoritativeAssessmentRun =
        authority?.activeEligibilityAssessmentRun;
      const authoritativeFingerprint =
        authoritativeAssessmentRun?.status === "COMPLETE" &&
        authoritativeAssessmentRun.invalidatedAt === null
          ? createChecklistSourceFingerprint({
              assessmentRunId: authoritativeAssessmentRun.id,
              assessmentSourceFingerprint:
                authoritativeAssessmentRun.sourceFingerprint,
              assessments: authoritativeAssessmentRun.assessments.map(
                (assessment) => ({
                  currentState: assessment.currentState,
                  evidenceLinkIds: assessment.evidenceLinks.map(
                    (link) => link.id,
                  ),
                  id: assessment.id,
                  reviewIds: assessment.reviews.map((review) => review.id),
                  reviewState: assessment.reviewState,
                  updatedAt: assessment.updatedAt,
                }),
              ),
              evidenceSnapshotId: authoritativeAssessmentRun.snapshotId,
            })
          : null;
      if (
        authoritativeAssessmentRun?.id !== run.assessmentRunId ||
        authoritativeAssessmentRun.snapshotId !== run.evidenceSnapshotId ||
        authoritativeFingerprint !== run.sourceFingerprint
      ) {
        await invalidateStaleRun(transaction, run.id, run.organisationId);
        return "INVALIDATED";
      }
      await transaction.checklistItem.deleteMany({
        where: { generationRunId: run.id },
      });
      for (const [deduplicationKey, entry] of grouped) {
        const item = await transaction.checklistItem.create({
          data: {
            completionCriteria: entry.proposal.completionCriteria,
            currentPriority: entry.proposal.priority,
            currentTitle: entry.proposal.title,
            deduplicationKey,
            evidenceNeedCategory: entry.proposal.evidenceNeedCategory,
            generationRuleId: entry.proposal.policyRule,
            generationRunId: run.id,
            itemType: entry.proposal.itemType,
            organisationId: run.organisationId,
            policyVersion: CHECKLIST_POLICY_VERSION,
            priorityRationale: entry.proposal.priorityRationale,
            proposedExplanation: entry.proposal.explanation,
            proposedPriority: entry.proposal.priority,
            proposedTitle: entry.proposal.title,
            sourceFingerprint: run.sourceFingerprint,
            tenderId: run.tenderId,
            tenderVersionId: run.tenderVersionId,
          },
        });
        await transaction.checklistItemAssessmentLink.createMany({
          data: entry.assessmentIds.map((assessmentId) => ({
            assessmentState:
              assessments.find((candidate) => candidate.id === assessmentId)
                ?.currentState ?? "HUMAN_REVIEW_REQUIRED",
            checklistItemId: item.id,
            eligibilityAssessmentId: assessmentId,
          })),
        });
        await transaction.checklistItemRequirementLink.createMany({
          data: entry.requirementIds.map((structuredRequirementId, index) => ({
            checklistItemId: item.id,
            requirementCategory:
              entry.requirementCategories[index] ?? "UNSPECIFIED",
            structuredRequirementId,
          })),
        });
        await transaction.checklistItemSourceCitation.createMany({
          data: entry.citations.map((citation) => ({
            checklistItemId: item.id,
            ...(citation.evidenceCitationId === undefined
              ? {}
              : { evidenceCitationId: citation.evidenceCitationId }),
            extractionCitationId: citation.extractionCitationId,
            sourceKind:
              citation.evidenceCitationId === undefined
                ? "TENDER_REQUIREMENT"
                : "TENDER_AND_COMPANY_EVIDENCE",
          })),
          skipDuplicates: true,
        });
        await transaction.checklistItemHistory.create({
          data: {
            action: "CREATE_FROM_POLICY",
            checklistItemId: item.id,
            eventVersion: 1,
            newPriority: item.currentPriority,
            newState: item.status,
            organisationId: run.organisationId,
            rationale: `Generated by ${CHECKLIST_POLICY_VERSION}`,
          },
        });
      }
      await transaction.checklistGenerationRun.updateMany({
        data: { activatedAt: null },
        where: {
          activatedAt: { not: null },
          invalidatedAt: null,
          organisationId: run.organisationId,
          tenderVersionId: run.tenderVersionId,
        },
      });
      const result = await transaction.checklistGenerationRun.updateMany({
        data: {
          activatedAt: new Date(),
          completedAt: new Date(),
          currentStage: "COMPLETE",
          eventSequence: { increment: 1 },
          progressPercentage: 100,
          publicMessage:
            "Checklist generated from the selected Phase 7 assessment snapshot",
          status: "COMPLETE",
        },
        where: {
          cancellationRequestedAt: null,
          id: run.id,
          invalidatedAt: null,
          organisationId: run.organisationId,
          status: {
            in: [
              "QUEUED",
              "LOADING_ASSESSMENTS",
              "GENERATING",
              "DEDUPLICATING",
              "VALIDATING",
            ],
          },
        },
      });
      if (result.count !== 1)
        throw new Error("CHECKLIST_CANCELLED_OR_INVALIDATED");
      await transaction.auditEvent.create({
        data: {
          eventType: "CHECKLIST_GENERATION_ACTIVATED",
          organisationId: run.organisationId,
          outcome: "SUCCESS",
          requestId: job.requestId,
          subjectId: run.id,
          subjectType: "checklist_generation_run",
        },
      });
      return "COMPLETE";
    });
    if (outcome === "INVALIDATED") return;
  }

  public async fail(runId: string, category: string): Promise<void> {
    const run = await this.database.checklistGenerationRun.findUnique({
      select: { cancellationRequestedAt: true },
      where: { id: runId },
    });
    await this.database.checklistGenerationRun.updateMany({
      data: {
        failureCategory:
          run?.cancellationRequestedAt === null ? category.slice(0, 80) : null,
        internalFailureReference:
          run?.cancellationRequestedAt === null ? crypto.randomUUID() : null,
        publicMessage:
          run?.cancellationRequestedAt === null
            ? "Checklist generation failed safely"
            : "Checklist generation cancelled",
        safeFailureMessage:
          run?.cancellationRequestedAt === null
            ? "Checklist generation could not be completed"
            : null,
        status: run?.cancellationRequestedAt === null ? "FAILED" : "CANCELLED",
      },
      where: {
        id: runId,
        status: {
          in: [
            "QUEUED",
            "LOADING_ASSESSMENTS",
            "GENERATING",
            "DEDUPLICATING",
            "VALIDATING",
          ],
        },
      },
    });
  }

  private async checkpoint(
    runId: string,
    signal: AbortSignal,
    status:
      "LOADING_ASSESSMENTS" | "GENERATING" | "DEDUPLICATING" | "VALIDATING",
    progressPercentage: number,
  ): Promise<void> {
    if (signal.aborted) throw new Error("CHECKLIST_TIMEOUT");
    const result = await this.database.checklistGenerationRun.updateMany({
      data: {
        currentStage: status,
        eventSequence: { increment: 1 },
        progressPercentage,
        ...(status === "LOADING_ASSESSMENTS" ? { startedAt: new Date() } : {}),
        status,
      },
      where: {
        cancellationRequestedAt: null,
        id: runId,
        invalidatedAt: null,
        status: {
          in: [
            "QUEUED",
            "LOADING_ASSESSMENTS",
            "GENERATING",
            "DEDUPLICATING",
            "VALIDATING",
          ],
        },
      },
    });
    if (result.count !== 1)
      throw new Error("CHECKLIST_CANCELLED_OR_INVALIDATED");
  }

  private async invalidate(runId: string): Promise<void> {
    await this.database.checklistGenerationRun.updateMany({
      data: {
        activatedAt: null,
        currentStage: "INVALIDATED",
        invalidatedAt: new Date(),
        publicMessage: "Authoritative Phase 7 inputs changed",
        status: "INVALIDATED",
      },
      where: { id: runId, invalidatedAt: null },
    });
  }
}

async function invalidateStaleRun(
  transaction: Pick<PrismaClient, "checklistGenerationRun" | "checklistItem">,
  runId: string,
  organisationId: string,
): Promise<void> {
  const invalidatedAt = new Date();
  await transaction.checklistGenerationRun.updateMany({
    data: {
      activatedAt: null,
      currentStage: "INVALIDATED",
      invalidatedAt,
      publicMessage: "Authoritative Phase 7 inputs changed",
      status: "INVALIDATED",
    },
    where: {
      id: runId,
      invalidatedAt: null,
      organisationId,
      status: {
        in: [
          "QUEUED",
          "LOADING_ASSESSMENTS",
          "GENERATING",
          "DEDUPLICATING",
          "VALIDATING",
          "COMPLETE",
        ],
      },
    },
  });
  await transaction.checklistItem.updateMany({
    data: { invalidatedAt, status: "INVALIDATED" },
    where: { generationRunId: runId, invalidatedAt: null },
  });
}

function createChecklistSourceFingerprint(input: {
  readonly assessmentRunId: string;
  readonly assessmentSourceFingerprint: string;
  readonly assessments: readonly {
    readonly currentState: string;
    readonly evidenceLinkIds: readonly string[];
    readonly id: string;
    readonly reviewIds: readonly string[];
    readonly reviewState: string;
    readonly updatedAt: Date;
  }[];
  readonly evidenceSnapshotId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        assessmentRunId: input.assessmentRunId,
        assessmentSourceFingerprint: input.assessmentSourceFingerprint,
        assessments: input.assessments.map((assessment) => [
          assessment.id,
          assessment.currentState,
          assessment.reviewState,
          assessment.updatedAt.toISOString(),
          [...assessment.evidenceLinkIds].sort(),
          [...assessment.reviewIds].sort(),
        ]),
        evidenceSnapshotId: input.evidenceSnapshotId,
        policies: [
          CHECKLIST_POLICY_VERSION,
          CHECKLIST_PRIORITY_POLICY_VERSION,
          CHECKLIST_DATE_POLICY_VERSION,
          CHECKLIST_DEDUPLICATION_POLICY_VERSION,
        ],
      }),
    )
    .digest("hex");
}

function sourcePairs(assessment: {
  readonly evidenceLinks: readonly {
    readonly evidenceCitation: { readonly id: string } | null;
  }[];
  readonly tenderCitationId: string;
}): {
  evidenceCitationId?: string;
  extractionCitationId: string;
}[] {
  const evidenceCitationIds = assessment.evidenceLinks.flatMap((link) =>
    link.evidenceCitation === null ? [] : [link.evidenceCitation.id],
  );
  return evidenceCitationIds.length === 0
    ? [{ extractionCitationId: assessment.tenderCitationId }]
    : evidenceCitationIds.map((evidenceCitationId) => ({
        evidenceCitationId,
        extractionCitationId: assessment.tenderCitationId,
      }));
}
