import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type MessageEvent,
} from "@nestjs/common";
import type {
  PursuitDecisionRequest,
  RiskFindingFilter,
  RiskReviewRequest,
} from "@tender/contracts";
import type { Prisma, PrismaClient, RiskAnalysisRun } from "@tender/database";
import { EARLY_RISK_POLICY_VERSION } from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { Observable } from "rxjs";
import { JOB_QUEUE, PRISMA_CLIENT } from "../infrastructure.tokens.js";
import { TenderWorkflowProgressionScheduler } from "../common/tender-workflow-progression-scheduler.service.js";

type RiskFindingWithHistory = Prisma.RiskFindingGetPayload<{
  include: {
    citations: { include: { extractionCitation: true } };
    reviews: true;
  };
}>;

@Injectable()
export class RisksService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    private readonly workflowProgression: TenderWorkflowProgressionScheduler,
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
      include: { activeExtractionRun: true },
      where: {
        id: versionId,
        tender: { deletedAt: null, id: tenderId, organisationId },
      },
    });
    if (version === null) throw new NotFoundException();
    const extraction = version.activeExtractionRun;
    if (extraction?.status !== "COMPLETE" || extraction.invalidatedAt !== null)
      throw new UnprocessableEntityException(
        "A current completed extraction is required",
      );
    const sourceFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          extractionRunId: extraction.id,
          extractionSourceFingerprint: extraction.sourceFingerprint,
          organisationId,
          policy: EARLY_RISK_POLICY_VERSION,
          versionId,
        }),
      )
      .digest("hex");
    const idempotencyKey = `${organisationId}:${clientKey}:${sourceFingerprint}`;
    const existing = await this.database.riskAnalysisRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return existing;
    if (triggerType === "USER") {
      const equivalent = await this.database.riskAnalysisRun.findFirst({
        orderBy: { createdAt: "desc" },
        where: {
          extractionRunId: extraction.id,
          gateType: "EARLY",
          organisationId,
          riskPolicyVersion: EARLY_RISK_POLICY_VERSION,
          sourceFingerprint,
          status: { in: ["QUEUED", "ANALYSING", "VALIDATING", "COMPLETE"] },
          tenderVersionId: versionId,
        },
      });
      if (equivalent !== null) return equivalent;
    }
    const run = await this.database.$transaction(async (transaction) => {
      await transaction.riskAnalysisRun.updateMany({
        data: {
          currentStage: "INVALIDATED",
          invalidatedAt: new Date(),
          publicMessage: "Superseded by a new early risk analysis input",
          status: "INVALIDATED",
        },
        where: {
          gateType: "EARLY",
          organisationId,
          status: "COMPLETE",
          tenderVersionId: versionId,
          extractionRunId: { not: extraction.id },
        },
      });
      const created = await transaction.riskAnalysisRun.create({
        data: {
          extractionRunId: extraction.id,
          gateType: "EARLY",
          idempotencyKey,
          organisationId,
          requestedByUserId: userId,
          riskPolicyVersion: EARLY_RISK_POLICY_VERSION,
          sourceFingerprint,
          tenderId,
          tenderVersionId: versionId,
          triggerType,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType:
            triggerType === "RETRY"
              ? "RISK_ANALYSIS_RETRIED"
              : "RISK_ANALYSIS_STARTED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: created.id,
          subjectType: "risk_analysis_run",
        },
      });
      return created;
    });
    await this.jobs.add(
      "analyse-early-tender-risk",
      { organisationId, requestId, riskAnalysisRunId: run.id },
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
    return this.database.riskAnalysisRun.findMany({
      orderBy: { createdAt: "desc" },
      where: {
        gateType: "EARLY",
        organisationId,
        tenderId,
        tenderVersionId: versionId,
      },
    });
  }

  public async current(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      include: { activeEarlyRiskRun: true },
      where: {
        id: versionId,
        tender: { id: tenderId, organisationId },
      },
    });
    if (version?.activeEarlyRiskRun == null) throw new NotFoundException();
    return version.activeEarlyRiskRun;
  }

  public async getRun(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<RiskAnalysisRun> {
    const run = await this.database.riskAnalysisRun.findFirst({
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async findings(
    organisationId: string,
    tenderId: string,
    runId: string,
    filter: RiskFindingFilter,
  ): Promise<unknown> {
    await this.getRun(organisationId, tenderId, runId);
    return this.database.riskFinding.findMany({
      include: {
        citations: {
          include: { extractionCitation: true },
        },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
      skip: filter.offset,
      take: filter.limit,
      where: {
        ...(filter.blocking === undefined
          ? {}
          : { blocking: filter.blocking === "true" }),
        ...(filter.category === undefined ? {} : { category: filter.category }),
        ...(filter.confidence === undefined
          ? {}
          : { confidence: filter.confidence }),
        ...(filter.materiality === undefined
          ? {}
          : { materiality: filter.materiality }),
        organisationId,
        ...(filter.review_state === undefined
          ? {}
          : { reviewState: filter.review_state }),
        riskAnalysisRunId: runId,
        ...(filter.severity === undefined ? {} : { severity: filter.severity }),
        ...(filter.status === undefined
          ? {}
          : { findingStatus: filter.status }),
      },
    });
  }

  public async finding(
    organisationId: string,
    tenderId: string,
    runId: string,
    findingId: string,
  ): Promise<RiskFindingWithHistory> {
    const finding = await this.database.riskFinding.findFirst({
      include: {
        citations: { include: { extractionCitation: true } },
        reviews: { orderBy: { reviewVersion: "asc" } },
      },
      where: {
        id: findingId,
        organisationId,
        riskAnalysisRun: { id: runId, tenderId },
      },
    });
    if (finding === null) throw new NotFoundException();
    return finding;
  }

  public async review(
    organisationId: string,
    tenderId: string,
    runId: string,
    findingId: string,
    input: RiskReviewRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const run = await this.getRun(organisationId, tenderId, runId);
    if (run.status !== "COMPLETE" || run.invalidatedAt !== null)
      throw new ConflictException();
    const finding = await this.finding(
      organisationId,
      tenderId,
      runId,
      findingId,
    );
    const newStatus = statusFor(input.action, finding.findingStatus);
    const newSeverity = input.severity ?? finding.severity;
    return this.database.$transaction(async (transaction) => {
      const aggregate = await transaction.riskFindingReview.aggregate({
        _max: { reviewVersion: true },
        where: { riskFindingId: findingId },
      });
      const review = await transaction.riskFindingReview.create({
        data: {
          action: input.action,
          actorUserId: userId,
          newSeverity,
          newStatus,
          organisationId,
          previousSeverity: finding.severity,
          previousStatus: finding.findingStatus,
          rationale: input.rationale,
          reviewVersion: (aggregate._max.reviewVersion ?? 0) + 1,
          riskAnalysisRunId: runId,
          riskFindingId: findingId,
        },
      });
      await transaction.riskFinding.update({
        data: {
          findingStatus: newStatus,
          reviewState:
            input.action === "REQUEST_REVIEW"
              ? "HUMAN_REVIEW_REQUIRED"
              : "REVIEWED",
          severity: newSeverity,
        },
        where: { id: findingId },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "RISK_FINDING_REVIEWED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: findingId,
          subjectType: "risk_finding",
        },
      });
      return review;
    });
  }

  public async decision(
    organisationId: string,
    tenderId: string,
    runId: string,
    input: PursuitDecisionRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const run = await this.getRun(organisationId, tenderId, runId);
    if (run.status !== "COMPLETE" || run.invalidatedAt !== null)
      throw new UnprocessableEntityException(
        "A current completed early risk analysis is required",
      );
    const unresolved = await this.database.riskFinding.count({
      where: {
        findingStatus: { in: ["OPEN", "UNDER_REVIEW"] },
        organisationId,
        riskAnalysisRunId: runId,
        severity: { in: ["HIGH", "CRITICAL"] },
      },
    });
    const decision = await this.database.$transaction(async (transaction) => {
      const prior = await transaction.earlyPursuitDecision.findFirst({
        orderBy: { createdAt: "desc" },
        where: { organisationId, riskAnalysisRunId: runId, supersededAt: null },
      });
      if (prior !== null)
        await transaction.earlyPursuitDecision.update({
          data: { supersededAt: new Date() },
          where: { id: prior.id },
        });
      if (prior !== null) {
        const invalidatedAt = new Date();
        await transaction.eligibilityAssessmentRun.updateMany({
          data: {
            currentStage: "INVALIDATED",
            invalidatedAt,
            publicMessage: "The human pursuit decision changed",
            status: "INVALIDATED",
          },
          where: {
            pursuitDecisionId: prior.id,
            status: {
              in: [
                "QUEUED",
                "SNAPSHOTTING",
                "MATCHING",
                "VALIDATING",
                "COMPLETE",
              ],
            },
          },
        });
        await transaction.eligibilityAssessment.updateMany({
          data: { invalidatedAt },
          where: {
            assessmentRun: { pursuitDecisionId: prior.id },
            invalidatedAt: null,
          },
        });
        await transaction.tenderVersion.updateMany({
          data: { activeEligibilityAssessmentRunId: null },
          where: {
            activeEligibilityAssessmentRun: { pursuitDecisionId: prior.id },
          },
        });
        await transaction.checklistGenerationRun.updateMany({
          data: {
            activatedAt: null,
            currentStage: "INVALIDATED",
            invalidatedAt,
            publicMessage: "The human pursuit decision changed",
            status: "INVALIDATED",
          },
          where: {
            invalidatedAt: null,
            pursuitDecisionId: prior.id,
          },
        });
        await transaction.checklistItem.updateMany({
          data: { invalidatedAt, status: "INVALIDATED" },
          where: {
            generationRun: { pursuitDecisionId: prior.id },
            invalidatedAt: null,
          },
        });
      }
      const decision = await transaction.earlyPursuitDecision.create({
        data: {
          acknowledgedLimitations: input.acknowledged_limitations,
          actorUserId: userId,
          decision: input.decision,
          organisationId,
          priorDecisionId: prior?.id ?? null,
          rationale: input.rationale,
          riskAnalysisRunId: runId,
          tenderId,
          tenderVersionId: run.tenderVersionId,
          unresolvedHighCriticalCount: unresolved,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "RISK_PURSUIT_DECISION_RECORDED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: decision.id,
          subjectType: "early_pursuit_decision",
        },
      });
      return decision;
    });
    if (decision.decision === "CONTINUE") {
      await this.workflowProgression.schedule({
        organisationId,
        requestId,
        tenderId,
        triggerId: decision.id,
        triggerType: "CONTINUE_DECISION",
        userId,
      });
    }
    return decision;
  }

  public async decisions(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    await this.getRun(organisationId, tenderId, runId);
    return this.database.earlyPursuitDecision.findMany({
      orderBy: { createdAt: "desc" },
      where: { organisationId, riskAnalysisRunId: runId },
    });
  }

  public async cancel(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.riskAnalysisRun.updateMany({
      data: {
        cancellationRequestedAt: new Date(),
        eventSequence: { increment: 1 },
        publicMessage: "Cancellation requested",
      },
      where: {
        id: runId,
        organisationId,
        status: { in: ["QUEUED", "ANALYSING", "VALIDATING"] },
        tenderId,
      },
    });
    if (result.count === 0) throw new ConflictException();
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "RISK_ANALYSIS_CANCELLED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: runId,
        subjectType: "risk_analysis_run",
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
    const run = await this.getRun(organisationId, tenderId, runId);
    if (run.status !== "FAILED") throw new ConflictException();
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
    return new Observable((subscriber) => {
      let lastSequence = 0;
      const started = Date.now();
      const timer = setInterval(() => {
        void this.getRun(organisationId, tenderId, runId)
          .then((run) => {
            if (run.eventSequence > lastSequence) {
              lastSequence = run.eventSequence;
              subscriber.next({
                data: {
                  current_stage: run.currentStage,
                  event_sequence: run.eventSequence,
                  progress_percentage: run.progressPercentage,
                  risk_run_id: run.id,
                  state: run.status,
                  timestamp: run.updatedAt.toISOString(),
                },
                id: String(run.eventSequence),
                type: "risk-progress",
              });
            } else
              subscriber.next({
                data: { timestamp: new Date().toISOString() },
                type: "heartbeat",
              });
            if (
              ["COMPLETE", "FAILED", "CANCELLED", "INVALIDATED"].includes(
                run.status,
              ) ||
              Date.now() - started > 15 * 60_000
            ) {
              clearInterval(timer);
              subscriber.complete();
            }
          })
          .catch((error: unknown) => subscriber.error(error));
      }, 2000);
      return () => clearInterval(timer);
    });
  }
}

function statusFor(
  action: RiskReviewRequest["action"],
  current:
    | "OPEN"
    | "UNDER_REVIEW"
    | "ACKNOWLEDGED"
    | "MITIGATED"
    | "ACCEPTED_RISK"
    | "DISMISSED"
    | "RESOLVED"
    | "SUPERSEDED"
    | "INVALIDATED",
):
  | "OPEN"
  | "UNDER_REVIEW"
  | "ACKNOWLEDGED"
  | "MITIGATED"
  | "ACCEPTED_RISK"
  | "DISMISSED"
  | "RESOLVED"
  | "SUPERSEDED"
  | "INVALIDATED" {
  const states = {
    ACCEPT_RISK: "ACCEPTED_RISK",
    ACKNOWLEDGE: "ACKNOWLEDGED",
    CHANGE_SEVERITY: current,
    CONFIRM: "ACKNOWLEDGED",
    DISMISS: "DISMISSED",
    MARK_MITIGATED: "MITIGATED",
    REOPEN: "OPEN",
    REQUEST_REVIEW: "UNDER_REVIEW",
    RESOLVE: "RESOLVED",
  } as const;
  return states[action];
}
