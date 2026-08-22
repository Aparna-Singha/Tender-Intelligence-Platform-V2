import type { PrismaClient } from "@tender/database";
import {
  analyseEarlyTenderRisk,
  RISK_RULE_VERSION,
  type RiskRuleInput,
} from "@tender/domain";
import { randomUUID } from "node:crypto";

export interface RiskAnalysisJob {
  readonly organisationId: string;
  readonly requestId: string;
  readonly riskAnalysisRunId: string;
}

export class RiskAnalysisProcessor {
  public constructor(private readonly database: PrismaClient) {}

  public async process(
    job: RiskAnalysisJob,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted();
    const run = await this.database.riskAnalysisRun.findFirst({
      include: {
        extractionRun: {
          include: {
            fields: {
              include: { citations: { include: { extractedBlock: true } } },
            },
            requirements: {
              include: { citations: { include: { extractedBlock: true } } },
            },
          },
        },
        tenderVersion: { select: { activeExtractionRunId: true } },
      },
      where: { id: job.riskAnalysisRunId, organisationId: job.organisationId },
    });
    if (run === null) throw new RiskProcessingFailure("RUN_NOT_FOUND");
    if (["COMPLETE", "CANCELLED", "INVALIDATED"].includes(run.status)) return;
    if (
      run.extractionRun.status !== "COMPLETE" ||
      run.tenderVersion.activeExtractionRunId !== run.extractionRunId
    ) {
      await this.invalidate(run.id);
      return;
    }
    await this.stage(
      run.id,
      "ANALYSING",
      20,
      "Applying deterministic early-risk rules",
    );
    const inputs = [
      ...run.extractionRun.fields.map((field) => toInput(field)),
      ...run.extractionRun.requirements.map((requirement) =>
        toInput(requirement),
      ),
    ];
    const findings = analyseEarlyTenderRisk(inputs);
    signal?.throwIfAborted();
    if (await this.cancelled(run.id)) return;
    await this.stage(
      run.id,
      "VALIDATING",
      75,
      "Validating findings and citations",
    );
    for (const finding of findings) {
      if (finding.citationIds.length === 0)
        throw new RiskProcessingFailure("UNSUPPORTED_FINDING");
      const citations = [
        ...run.extractionRun.fields,
        ...run.extractionRun.requirements,
      ]
        .flatMap((item) => item.citations)
        .filter((citation) => finding.citationIds.includes(citation.id));
      if (
        citations.length !== finding.citationIds.length ||
        citations.some(
          (citation) =>
            citation.extractionRunId !== run.extractionRunId ||
            !["VALID", "VALIDATED"].includes(citation.validationStatus) ||
            citation.extractedBlock === null ||
            !citation.extractedBlock.normalizedText.includes(
              citation.boundedExcerpt,
            ) ||
            citation.sourceChecksum.length !== 64,
        )
      )
        throw new RiskProcessingFailure("CITATION_VALIDATION_FAILED");
    }
    await this.database.$transaction(async (transaction) => {
      const current = await transaction.riskAnalysisRun.findFirst({
        where: {
          cancellationRequestedAt: null,
          id: run.id,
          organisationId: run.organisationId,
          status: "VALIDATING",
        },
      });
      if (current === null)
        throw new RiskProcessingFailure("RUN_NOT_COMMITTABLE");
      for (const finding of findings) {
        const record = await transaction.riskFinding.create({
          data: {
            blocking: finding.blocking,
            category: finding.category,
            confidence: finding.confidence,
            deterministicRuleId: finding.ruleId,
            deterministicRuleVersion: RISK_RULE_VERSION,
            explanation: finding.explanation,
            extractionRunId: run.extractionRunId,
            materiality: finding.materiality,
            organisationId: run.organisationId,
            riskAnalysisRunId: run.id,
            severity: finding.severity,
            sourceInputFingerprint: run.sourceFingerprint,
            sourceSupportedRationale: finding.rationale,
            tenderId: run.tenderId,
            tenderVersionId: run.tenderVersionId,
            title: finding.title,
          },
        });
        await transaction.riskFindingCitation.createMany({
          data: finding.citationIds.map((extractionCitationId) => ({
            extractionCitationId,
            riskFindingId: record.id,
            validationStatus: "VALIDATED",
          })),
        });
      }
      const highCritical = findings.filter((finding) =>
        ["HIGH", "CRITICAL"].includes(finding.severity),
      ).length;
      await transaction.riskAnalysisRun.update({
        data: {
          completedAt: new Date(),
          currentStage: "COMPLETE",
          eventSequence: { increment: 1 },
          progressPercentage: 100,
          publicMessage:
            "Early cited risk analysis complete; human review required",
          status: "COMPLETE",
          summary: {
            blocking_or_potentially_blocking: findings.filter((finding) =>
              [
                "POTENTIALLY_BLOCKING",
                "BLOCKING_REQUIRES_HUMAN_DISPOSITION",
              ].includes(finding.materiality),
            ).length,
            findings: findings.length,
            unresolved_high_critical: highCritical,
          },
        },
        where: { id: run.id },
      });
      await transaction.tenderVersion.update({
        data: {
          activeEarlyRiskRunId: run.id,
          activeEligibilityAssessmentRunId: null,
        },
        where: { id: run.tenderVersionId },
      });
      const invalidatedAt = new Date();
      await transaction.eligibilityAssessmentRun.updateMany({
        data: {
          currentStage: "INVALIDATED",
          invalidatedAt,
          publicMessage:
            "A newer EARLY risk run requires fresh evidence comparison",
          status: "INVALIDATED",
        },
        where: {
          riskAnalysisRunId: { not: run.id },
          status: {
            in: [
              "QUEUED",
              "SNAPSHOTTING",
              "MATCHING",
              "VALIDATING",
              "COMPLETE",
            ],
          },
          tenderVersionId: run.tenderVersionId,
        },
      });
      await transaction.eligibilityAssessment.updateMany({
        data: { invalidatedAt },
        where: {
          assessmentRun: {
            riskAnalysisRunId: { not: run.id },
            tenderVersionId: run.tenderVersionId,
          },
          invalidatedAt: null,
        },
      });
      await transaction.checklistGenerationRun.updateMany({
        data: {
          activatedAt: null,
          currentStage: "INVALIDATED",
          invalidatedAt,
          publicMessage: "A newer risk analysis requires a fresh checklist",
          status: "INVALIDATED",
        },
        where: {
          invalidatedAt: null,
          organisationId: run.organisationId,
          tenderVersionId: run.tenderVersionId,
        },
      });
      await transaction.checklistItem.updateMany({
        data: { invalidatedAt, status: "INVALIDATED" },
        where: {
          invalidatedAt: null,
          organisationId: run.organisationId,
          tenderVersionId: run.tenderVersionId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: run.requestedByUserId,
          eventType: "RISK_ANALYSIS_ACTIVATED",
          organisationId: run.organisationId,
          outcome: "SUCCESS",
          requestId: job.requestId,
          subjectId: run.id,
          subjectType: "risk_analysis_run",
        },
      });
    });
  }

  public async fail(runId: string, category: string): Promise<void> {
    await this.database.riskAnalysisRun.updateMany({
      data: {
        failureCategory: category.slice(0, 80),
        internalFailureReference: randomUUID(),
        publicMessage: "Early risk analysis failed safely",
        safeFailureMessage:
          "Analysis could not be completed. Retry or contact support.",
        status: "FAILED",
      },
      where: {
        id: runId,
        status: { in: ["QUEUED", "ANALYSING", "VALIDATING"] },
      },
    });
  }

  private async stage(
    id: string,
    status: "ANALYSING" | "VALIDATING",
    progressPercentage: number,
    publicMessage: string,
  ): Promise<void> {
    await this.database.riskAnalysisRun.update({
      data: {
        currentStage: status,
        eventSequence: { increment: 1 },
        progressPercentage,
        publicMessage,
        ...(status === "ANALYSING" ? { startedAt: new Date() } : {}),
        status,
      },
      where: { id },
    });
  }

  private async cancelled(id: string): Promise<boolean> {
    const run = await this.database.riskAnalysisRun.findUnique({
      select: { cancellationRequestedAt: true },
      where: { id },
    });
    if (run?.cancellationRequestedAt === null) return false;
    await this.database.riskAnalysisRun.updateMany({
      data: {
        currentStage: "CANCELLED",
        publicMessage: "Early risk analysis cancelled",
        status: "CANCELLED",
      },
      where: { id, status: { in: ["QUEUED", "ANALYSING", "VALIDATING"] } },
    });
    return true;
  }

  private async invalidate(id: string): Promise<void> {
    await this.database.riskAnalysisRun.update({
      data: {
        currentStage: "INVALIDATED",
        invalidatedAt: new Date(),
        publicMessage: "Input extraction changed; a new analysis is required",
        status: "INVALIDATED",
      },
      where: { id },
    });
  }
}

export class RiskProcessingFailure extends Error {}

function toInput(item: {
  readonly citations: readonly { readonly id: string }[];
  readonly confidence: string;
  readonly findingState: string;
  readonly sourceWording: string;
}): RiskRuleInput {
  return {
    citationIds: item.citations.map((citation) => citation.id),
    confidence: asConfidence(item.confidence),
    findingState: item.findingState,
    sourceWording: item.sourceWording,
  };
}

function asConfidence(value: string): RiskRuleInput["confidence"] {
  if (
    value === "HIGH" ||
    value === "MEDIUM" ||
    value === "LOW" ||
    value === "HUMAN_REVIEW_REQUIRED"
  )
    return value;
  return "HUMAN_REVIEW_REQUIRED";
}
