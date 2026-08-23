import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type MessageEvent,
} from "@nestjs/common";
import type {
  ChecklistFilter,
  UpdateChecklistItemRequest,
} from "@tender/contracts";
import { Prisma, type PrismaClient } from "@tender/database";
import {
  canTransitionChecklistItem,
  CHECKLIST_DATE_POLICY_VERSION,
  CHECKLIST_DEDUPLICATION_POLICY_VERSION,
  CHECKLIST_POLICY_VERSION,
  CHECKLIST_PRIORITY_POLICY_VERSION,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { Observable, concat, from, interval, map, takeUntil } from "rxjs";
import { JOB_QUEUE, PRISMA_CLIENT } from "../infrastructure.tokens.js";

const activeStatuses = [
  "QUEUED",
  "LOADING_ASSESSMENTS",
  "GENERATING",
  "DEDUPLICATING",
  "VALIDATING",
] as const;
type ChecklistItemDetail = Prisma.ChecklistItemGetPayload<{
  include: {
    assessmentLinks: true;
    history: true;
    requirementLinks: true;
    sourceCitations: true;
  };
}>;

@Injectable()
export class ChecklistsService {
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
      include: {
        activeEarlyRiskRun: true,
        activeEligibilityAssessmentRun: {
          include: {
            assessments: {
              include: { evidenceLinks: true, reviews: true },
              orderBy: { id: "asc" },
            },
            snapshot: true,
          },
        },
        activeExtractionRun: true,
      },
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
    const assessment = version.activeEligibilityAssessmentRun;
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
      where: {
        decision: "CONTINUE",
        organisationId,
        riskAnalysisRunId: risk.id,
        supersededAt: null,
        tenderId,
        tenderVersionId: versionId,
      },
    });
    if (decision === null)
      throw new ConflictException(
        "A current authorised CONTINUE decision is required",
      );
    if (
      assessment?.status !== "COMPLETE" ||
      assessment.invalidatedAt !== null ||
      assessment.extractionRunId !== extraction.id ||
      assessment.riskAnalysisRunId !== risk.id ||
      assessment.pursuitDecisionId !== decision.id ||
      assessment.snapshot.fingerprint !== assessment.sourceFingerprint
    )
      throw new ConflictException(
        "A current completed Phase 7 assessment and evidence snapshot are required",
      );

    const fingerprint = createChecklistSourceFingerprint({
      assessmentRunId: assessment.id,
      assessmentSourceFingerprint: assessment.sourceFingerprint,
      assessments: assessment.assessments.map((item) => ({
        currentState: item.currentState,
        evidenceLinkIds: item.evidenceLinks.map((link) => link.id),
        id: item.id,
        reviewIds: item.reviews.map((review) => review.id),
        reviewState: item.reviewState,
        updatedAt: item.updatedAt,
      })),
      evidenceSnapshotId: assessment.snapshotId,
    });
    const idempotencyKey =
      triggerType === "RETRY"
        ? `${organisationId}:${clientKey}:${fingerprint}`
        : `${organisationId}:current:${fingerprint}`;
    const existing = await this.database.checklistGenerationRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return existing;
    const existingFingerprintRun =
      await this.database.checklistGenerationRun.findFirst({
        orderBy: { createdAt: "desc" },
        where: {
          invalidatedAt: null,
          organisationId,
          sourceFingerprint: fingerprint,
          status: { in: [...activeStatuses, "COMPLETE"] },
          tenderId,
          tenderVersionId: versionId,
        },
      });
    if (existingFingerprintRun !== null) return existingFingerprintRun;

    let run;
    try {
      run = await this.database.$transaction(async (transaction) => {
        const created = await transaction.checklistGenerationRun.create({
          data: {
            assessmentRunId: assessment.id,
            checklistPolicyVersion: CHECKLIST_POLICY_VERSION,
            datePolicyVersion: CHECKLIST_DATE_POLICY_VERSION,
            deduplicationPolicyVersion: CHECKLIST_DEDUPLICATION_POLICY_VERSION,
            evidenceSnapshotId: assessment.snapshotId,
            extractionRunId: extraction.id,
            idempotencyKey,
            organisationId,
            priorityPolicyVersion: CHECKLIST_PRIORITY_POLICY_VERSION,
            pursuitDecisionId: decision.id,
            requestedByUserId: userId,
            riskAnalysisRunId: risk.id,
            sourceFingerprint: fingerprint,
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
                ? "CHECKLIST_GENERATION_RETRIED"
                : "CHECKLIST_GENERATION_STARTED",
            organisationId,
            outcome: "SUCCESS",
            requestId,
            subjectId: created.id,
            subjectType: "checklist_generation_run",
          },
        });
        return created;
      });
    } catch (error) {
      if (
        triggerType !== "RETRY" &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const concurrentRun =
          await this.database.checklistGenerationRun.findUnique({
            where: { idempotencyKey },
          });
        if (concurrentRun !== null) return concurrentRun;
      }
      throw error;
    }
    await this.jobs.add(
      "generate-missing-action-checklist",
      { checklistRunId: run.id, organisationId, requestId },
      {
        attempts: 2,
        backoff: { delay: 2000, type: "exponential" },
        jobId: run.id,
        removeOnComplete: 100,
      },
    );
    return run;
  }

  public runs(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    return this.database.checklistGenerationRun.findMany({
      orderBy: { createdAt: "desc" },
      where: { organisationId, tenderId, tenderVersionId: versionId },
    });
  }

  public async current(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<unknown> {
    const run = await this.database.checklistGenerationRun.findFirst({
      orderBy: { activatedAt: "desc" },
      where: {
        activatedAt: { not: null },
        invalidatedAt: null,
        organisationId,
        status: "COMPLETE",
        tenderId,
        tenderVersionId: versionId,
      },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async run(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<Prisma.ChecklistGenerationRunGetPayload<Record<string, never>>> {
    const run = await this.database.checklistGenerationRun.findFirst({
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async items(
    organisationId: string,
    tenderId: string,
    runId: string,
    filter: ChecklistFilter,
  ): Promise<unknown> {
    await this.run(organisationId, tenderId, runId);
    const now = new Date();
    const where: Prisma.ChecklistItemWhereInput = {
      generationRunId: runId,
      organisationId,
      tenderId,
      ...(filter.item_type === undefined ? {} : { itemType: filter.item_type }),
      ...(filter.priority === undefined
        ? {}
        : { currentPriority: filter.priority }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.assignee_id === undefined
        ? {}
        : { assigneeUserId: filter.assignee_id }),
      ...(filter.assessment_state === undefined
        ? {}
        : {
            assessmentLinks: {
              some: { assessmentState: filter.assessment_state },
            },
          }),
      ...(filter.requirement_category === undefined
        ? {}
        : {
            requirementLinks: {
              some: { requirementCategory: filter.requirement_category },
            },
          }),
      ...(filter.blocked === undefined
        ? {}
        : {
            status:
              filter.blocked === "true"
                ? ("BLOCKED" as const)
                : { not: "BLOCKED" as const },
          }),
      ...(filter.overdue === "true"
        ? {
            currentDueDate: { lt: now },
            status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] },
          }
        : {}),
      ...(filter.due_after === undefined
        ? {}
        : { currentDueDate: { gte: filter.due_after } }),
      ...(filter.due_before === undefined
        ? {}
        : { currentDueDate: { lte: filter.due_before } }),
    };
    const [items, total, statusCounts, priorityCounts] = await Promise.all([
      this.database.checklistItem.findMany({
        include: {
          assessmentLinks: true,
          requirementLinks: true,
          sourceCitations: true,
        },
        orderBy: [{ currentPriority: "asc" }, { createdAt: "asc" }],
        skip: filter.offset,
        take: filter.limit,
        where,
      }),
      this.database.checklistItem.count({ where }),
      this.database.checklistItem.groupBy({
        _count: true,
        by: ["status"],
        where: { generationRunId: runId, organisationId },
      }),
      this.database.checklistItem.groupBy({
        _count: true,
        by: ["currentPriority"],
        where: { generationRunId: runId, organisationId },
      }),
    ]);
    return {
      items,
      priority_counts: priorityCounts,
      status_counts: statusCounts,
      total,
    };
  }

  public async item(
    organisationId: string,
    tenderId: string,
    runId: string,
    itemId: string,
  ): Promise<ChecklistItemDetail> {
    const item = await this.database.checklistItem.findFirst({
      include: {
        assessmentLinks: true,
        history: { orderBy: { eventVersion: "asc" } },
        requirementLinks: true,
        sourceCitations: true,
      },
      where: {
        generationRunId: runId,
        id: itemId,
        organisationId,
        tenderId,
      },
    });
    if (item === null) throw new NotFoundException();
    return item;
  }

  public async update(
    organisationId: string,
    tenderId: string,
    runId: string,
    itemId: string,
    input: UpdateChecklistItemRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const item = await this.item(organisationId, tenderId, runId, itemId);
    if (item.invalidatedAt !== null || item.status === "SUPERSEDED")
      throw new ConflictException(
        "Historical checklist items cannot be changed",
      );
    if (input.assignee_id !== undefined && input.assignee_id !== null) {
      const member = await this.database.organisationMembership.findFirst({
        where: {
          organisationId,
          revokedAt: null,
          userId: input.assignee_id,
        },
      });
      if (member === null) throw new NotFoundException();
    }

    let resolutionProvenance = false;
    if (input.status === "RESOLVED") {
      const links = await this.database.checklistItemAssessmentLink.findMany({
        include: { checklistItem: false },
        where: { checklistItemId: itemId },
      });
      const unresolved = await this.database.eligibilityAssessment.count({
        where: {
          assessmentRun: {
            activeForVersion: { isNot: null },
            invalidatedAt: null,
          },
          currentState: {
            in: ["MISSING", "CONFLICT", "HUMAN_REVIEW_REQUIRED"],
          },
          id: { in: links.map((link) => link.eligibilityAssessmentId) },
          organisationId,
          tenderId,
        },
      });
      resolutionProvenance = links.length > 0 && unresolved === 0;
    }
    if (
      input.status !== undefined &&
      input.status !== item.status &&
      !canTransitionChecklistItem(item.status, input.status, {
        ...(input.blocked_reason === undefined
          ? {}
          : { blockedReason: input.blocked_reason }),
        ...(input.dismissal_rationale === undefined
          ? {}
          : { dismissalRationale: input.dismissal_rationale }),
        resolutionProvenance,
      })
    )
      throw new UnprocessableEntityException(
        "The requested checklist transition is not permitted",
      );

    return this.database.$transaction(async (transaction) => {
      const eventVersion = await transaction.checklistItemHistory.count({
        where: { checklistItemId: itemId },
      });
      const updated = await transaction.checklistItem.update({
        data: {
          ...(input.assignee_id === undefined
            ? {}
            : { assigneeUserId: input.assignee_id }),
          ...(input.blocked_reason === undefined
            ? {}
            : { blockedReason: input.blocked_reason }),
          ...(input.current_description === undefined
            ? {}
            : { currentDescription: input.current_description }),
          ...(input.current_priority === undefined
            ? {}
            : { currentPriority: input.current_priority }),
          ...(input.current_title === undefined
            ? {}
            : { currentTitle: input.current_title }),
          ...(input.dismissal_rationale === undefined
            ? {}
            : { dismissalRationale: input.dismissal_rationale }),
          ...(input.due_date === undefined
            ? {}
            : {
                currentDueDate: input.due_date,
                dateSource: "HUMAN_ASSIGNED" as const,
                dateIsOfficial: false,
              }),
          ...(input.resolution_note === undefined
            ? {}
            : { resolutionNote: input.resolution_note }),
          ...(input.status === undefined
            ? {}
            : {
                status: input.status,
                ...(input.status === "RESOLVED"
                  ? { completedAt: new Date() }
                  : {}),
                ...(input.status === "DISMISSED"
                  ? { dismissedAt: new Date() }
                  : {}),
              }),
        },
        where: { id: itemId },
      });
      await transaction.checklistItemHistory.create({
        data: {
          action: historyAction(item, input),
          actorUserId: userId,
          checklistItemId: itemId,
          eventVersion: eventVersion + 1,
          newAssigneeId: updated.assigneeUserId,
          newPriority: updated.currentPriority,
          newState: updated.status,
          organisationId,
          previousAssigneeId: item.assigneeUserId,
          previousPriority: item.currentPriority,
          previousState: item.status,
          rationale: input.rationale,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: auditEvent(input),
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: itemId,
          subjectType: "checklist_item",
        },
      });
      return updated;
    });
  }

  public async cancel(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.checklistGenerationRun.updateMany({
      data: { cancellationRequestedAt: new Date() },
      where: {
        id: runId,
        organisationId,
        status: { in: [...activeStatuses] },
        tenderId,
      },
    });
    if (result.count !== 1) throw new ConflictException();
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "CHECKLIST_GENERATION_CANCELLED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: runId,
        subjectType: "checklist_generation_run",
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
    const failed = await this.database.checklistGenerationRun.findFirst({
      where: {
        id: runId,
        organisationId,
        status: "FAILED",
        tenderId,
      },
    });
    if (failed === null) throw new ConflictException();
    return this.start(
      organisationId,
      tenderId,
      failed.tenderVersionId,
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
      interval(2_000).pipe(
        map((): MessageEvent => ({ data: { heartbeat: true } })),
        takeUntil(terminal),
      ),
      terminal.pipe(map((data): MessageEvent => ({ data }))),
    );
  }

  private async safeEvent(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<Record<string, unknown>> {
    const run = await this.database.checklistGenerationRun.findFirst({
      select: {
        assessmentRunId: true,
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
    return run;
  }

  private async waitForTerminal(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const event = await this.safeEvent(organisationId, tenderId, runId);
      if (
        "status" in event &&
        ["COMPLETE", "FAILED", "CANCELLED", "INVALIDATED"].includes(
          String(event.status),
        )
      )
        return event;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    return { status: "CONNECTION_CLOSED" };
  }
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

function historyAction(
  item: Awaited<ReturnType<ChecklistsService["item"]>>,
  input: UpdateChecklistItemRequest,
):
  | "EDIT_TITLE"
  | "EDIT_DESCRIPTION"
  | "CHANGE_PRIORITY"
  | "ASSIGN"
  | "UNASSIGN"
  | "SET_DUE_DATE"
  | "START"
  | "BLOCK"
  | "UNBLOCK"
  | "MARK_READY_FOR_REASSESSMENT"
  | "MARK_RESOLVED"
  | "DISMISS"
  | "REOPEN"
  | "ADD_RESOLUTION_NOTE" {
  if (input.status === "IN_PROGRESS")
    return item.status === "BLOCKED" ? "UNBLOCK" : "START";
  if (input.status === "BLOCKED") return "BLOCK";
  if (input.status === "READY_FOR_REASSESSMENT")
    return "MARK_READY_FOR_REASSESSMENT";
  if (input.status === "RESOLVED") return "MARK_RESOLVED";
  if (input.status === "DISMISSED") return "DISMISS";
  if (input.status === "OPEN") return "REOPEN";
  if (input.assignee_id !== undefined)
    return input.assignee_id === null ? "UNASSIGN" : "ASSIGN";
  if (input.current_priority !== undefined) return "CHANGE_PRIORITY";
  if (input.due_date !== undefined) return "SET_DUE_DATE";
  if (input.current_title !== undefined) return "EDIT_TITLE";
  if (input.current_description !== undefined) return "EDIT_DESCRIPTION";
  return "ADD_RESOLUTION_NOTE";
}

function auditEvent(
  input: UpdateChecklistItemRequest,
):
  | "CHECKLIST_ITEM_ASSIGNED"
  | "CHECKLIST_ITEM_PRIORITY_CHANGED"
  | "CHECKLIST_ITEM_DUE_DATE_CHANGED"
  | "CHECKLIST_ITEM_WORK_STARTED"
  | "CHECKLIST_ITEM_BLOCKED"
  | "CHECKLIST_ITEM_READY_FOR_REASSESSMENT"
  | "CHECKLIST_ITEM_RESOLVED"
  | "CHECKLIST_ITEM_DISMISSED"
  | "CHECKLIST_ITEM_REOPENED" {
  if (input.status === "BLOCKED") return "CHECKLIST_ITEM_BLOCKED";
  if (input.status === "READY_FOR_REASSESSMENT")
    return "CHECKLIST_ITEM_READY_FOR_REASSESSMENT";
  if (input.status === "RESOLVED") return "CHECKLIST_ITEM_RESOLVED";
  if (input.status === "DISMISSED") return "CHECKLIST_ITEM_DISMISSED";
  if (input.status === "OPEN") return "CHECKLIST_ITEM_REOPENED";
  if (input.status === "IN_PROGRESS") return "CHECKLIST_ITEM_WORK_STARTED";
  if (input.assignee_id !== undefined) return "CHECKLIST_ITEM_ASSIGNED";
  if (input.current_priority !== undefined)
    return "CHECKLIST_ITEM_PRIORITY_CHANGED";
  return "CHECKLIST_ITEM_DUE_DATE_CHANGED";
}
