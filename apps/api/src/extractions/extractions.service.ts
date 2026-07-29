import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type MessageEvent,
} from "@nestjs/common";
import type {
  ExtractionPagination,
  RequirementFilter,
  ReviewExtractionRequest,
} from "@tender/contracts";
import type { PrismaClient } from "@tender/database";
import {
  PARSER_POLICY_VERSION,
  STRUCTURING_POLICY_VERSION,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { Observable } from "rxjs";
import { JOB_QUEUE, PRISMA_CLIENT } from "../infrastructure.tokens.js";

@Injectable()
export class ExtractionsService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
  ) {}

  public async start(
    organisationId: string,
    tenderId: string,
    versionId: string,
    userId: string,
    clientIdempotencyKey: string,
    requestId: string,
    triggerType: "USER" | "RETRY" = "USER",
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      include: {
        documents: {
          orderBy: { id: "asc" },
          select: {
            approvedObjectKey: true,
            id: true,
            sha256: true,
            status: true,
          },
          where: { deletedAt: null },
        },
        tender: { select: { lifecycleStatus: true } },
      },
      where: {
        id: versionId,
        tender: { deletedAt: null, id: tenderId, organisationId },
      },
    });
    if (version === null) throw new NotFoundException();
    if (
      version.tender.lifecycleStatus !== "SOURCE_READY" ||
      version.documents.length === 0 ||
      version.documents.some(
        (document) =>
          document.status !== "READY" || document.approvedObjectKey === null,
      )
    )
      throw new UnprocessableEntityException(
        "The selected tender version is not source-ready",
      );
    const sourceFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          documents: version.documents.map((document) => ({
            id: document.id,
            sha256: document.sha256,
          })),
          organisationId,
          parserPolicy: PARSER_POLICY_VERSION,
          structuringPolicy: STRUCTURING_POLICY_VERSION,
          versionId,
        }),
      )
      .digest("hex");
    const idempotencyKey = `${organisationId}:${clientIdempotencyKey}:${sourceFingerprint}`;
    const existing = await this.database.extractionRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return publicRun(existing);
    if (triggerType === "USER") {
      const equivalent = await this.database.extractionRun.findFirst({
        orderBy: { createdAt: "desc" },
        where: {
          organisationId,
          parserPolicyVersion: PARSER_POLICY_VERSION,
          sourceFingerprint,
          status: { in: ["QUEUED", "PARSING", "STRUCTURING", "COMPLETE"] },
          structuringPolicyVersion: STRUCTURING_POLICY_VERSION,
          tenderVersionId: versionId,
        },
      });
      if (equivalent !== null) return publicRun(equivalent);
    }
    const run = await this.database.$transaction(async (transaction) => {
      const created = await transaction.extractionRun.create({
        data: {
          idempotencyKey,
          organisationId,
          parserPolicyVersion: PARSER_POLICY_VERSION,
          requestedByUserId: userId,
          sourceFingerprint,
          structuringPolicyVersion: STRUCTURING_POLICY_VERSION,
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
              ? "EXTRACTION_RETRIED"
              : "EXTRACTION_STARTED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: created.id,
          subjectType: "extraction_run",
          metadata: {
            tender_id: tenderId,
            tender_version_id: versionId,
          },
        },
      });
      return created;
    });
    await this.jobs.add(
      "extract-tender-version",
      {
        extractionRunId: run.id,
        organisationId,
        requestId,
      },
      {
        attempts: 3,
        backoff: { delay: 2000, type: "exponential" },
        jobId: run.id,
        removeOnComplete: 100,
      },
    );
    return publicRun(run);
  }

  public async listRuns(
    organisationId: string,
    tenderId: string,
    versionId: string,
    pagination: ExtractionPagination,
  ): Promise<unknown> {
    await this.requireVersion(organisationId, tenderId, versionId);
    const runs = await this.database.extractionRun.findMany({
      orderBy: { createdAt: "desc" },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { organisationId, tenderId, tenderVersionId: versionId },
    });
    return runs.map(publicRun);
  }

  public async getRun(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.extractionRun.findFirst({
      include: {
        documents: {
          select: {
            detectedFormat: true,
            id: true,
            parserName: true,
            parserVersion: true,
            status: true,
            tenderDocument: {
              select: {
                displayFilename: true,
                id: true,
                role: true,
                sha256: true,
              },
            },
            warningCount: true,
          },
        },
      },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return { ...publicRun(run), documents: run.documents };
  }

  public async quality(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    const run = await this.database.extractionRun.findFirst({
      select: { id: true, qualitySummary: true, status: true },
      where: { id: runId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async listUnits(
    organisationId: string,
    tenderId: string,
    runId: string,
    pagination: ExtractionPagination,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    return this.database.extractedUnit.findMany({
      orderBy: [{ extractionRunDocumentId: "asc" }, { unitIndex: "asc" }],
      select: {
        archiveMemberPath: true,
        characterCount: true,
        id: true,
        label: true,
        language: true,
        ocrConfidence: true,
        ocrStatus: true,
        parserConfidence: true,
        unitIndex: true,
        unitType: true,
      },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { extractionRunId: runId },
    });
  }

  public async listBlocks(
    organisationId: string,
    tenderId: string,
    runId: string,
    pagination: ExtractionPagination,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    return this.database.extractedBlock.findMany({
      orderBy: [{ extractedUnitId: "asc" }, { readingOrder: "asc" }],
      select: {
        blockType: true,
        confidence: true,
        extractedUnitId: true,
        headingLevel: true,
        id: true,
        normalizedText: true,
        readingOrder: true,
        warnings: true,
      },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { extractionRunId: runId },
    });
  }

  public async listSections(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    return this.database.classifiedSection.findMany({
      orderBy: { startReadingOrder: "asc" },
      where: { extractionRunId: runId },
    });
  }

  public async listFields(
    organisationId: string,
    tenderId: string,
    runId: string,
    pagination: ExtractionPagination,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    return this.database.extractedTenderField.findMany({
      include: { citations: true },
      orderBy: { createdAt: "asc" },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { extractionRunId: runId },
    });
  }

  public async getField(
    organisationId: string,
    tenderId: string,
    runId: string,
    fieldId: string,
  ): Promise<unknown> {
    const field = await this.database.extractedTenderField.findFirst({
      include: {
        citations: true,
        extractionRun: { select: { organisationId: true, tenderId: true } },
      },
      where: {
        extractionRun: { organisationId, tenderId },
        extractionRunId: runId,
        id: fieldId,
      },
    });
    if (field === null) throw new NotFoundException();
    return {
      ...field,
      reviews: await this.reviewHistory(runId, "FIELD", fieldId),
    };
  }

  public async listRequirements(
    organisationId: string,
    tenderId: string,
    runId: string,
    filter: RequirementFilter,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    return this.database.structuredRequirement.findMany({
      include: { citations: true },
      orderBy: { createdAt: "asc" },
      skip: filter.cursor === undefined ? 0 : 1,
      take: filter.limit,
      ...(filter.cursor === undefined ? {} : { cursor: { id: filter.cursor } }),
      where: {
        extractionRunId: runId,
        ...(filter.category === undefined ? {} : { category: filter.category }),
        ...(filter.confidence === undefined
          ? {}
          : { confidence: filter.confidence }),
        ...(filter.obligation === undefined
          ? {}
          : { obligation: filter.obligation }),
        ...(filter.review_state === undefined
          ? {}
          : { reviewState: filter.review_state }),
        ...(filter.search === undefined
          ? {}
          : {
              OR: [
                {
                  normalizedStatement: {
                    contains: filter.search,
                    mode: "insensitive",
                  },
                },
                {
                  sourceWording: {
                    contains: filter.search,
                    mode: "insensitive",
                  },
                },
              ],
            }),
      },
    });
  }

  public async getRequirement(
    organisationId: string,
    tenderId: string,
    runId: string,
    requirementId: string,
  ): Promise<unknown> {
    const requirement = await this.database.structuredRequirement.findFirst({
      include: { citations: true },
      where: {
        extractionRun: { organisationId, tenderId },
        extractionRunId: runId,
        id: requirementId,
      },
    });
    if (requirement === null) throw new NotFoundException();
    return {
      ...requirement,
      reviews: await this.reviewHistory(runId, "REQUIREMENT", requirementId),
    };
  }

  public async issues(
    organisationId: string,
    tenderId: string,
    runId: string,
    pagination: ExtractionPagination,
  ): Promise<unknown> {
    await this.requireRun(organisationId, tenderId, runId);
    return this.database.extractionIssue.findMany({
      orderBy: { createdAt: "asc" },
      skip: pagination.cursor === undefined ? 0 : 1,
      take: pagination.limit,
      ...(pagination.cursor === undefined
        ? {}
        : { cursor: { id: pagination.cursor } }),
      where: { extractionRunId: runId },
    });
  }

  public async review(
    organisationId: string,
    tenderId: string,
    runId: string,
    targetType: "FIELD" | "REQUIREMENT",
    targetId: string,
    input: ReviewExtractionRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<unknown> {
    await this.requireTarget(
      organisationId,
      tenderId,
      runId,
      targetType,
      targetId,
    );
    return this.database.$transaction(async (transaction) => {
      const latest = await transaction.extractionReview.findFirst({
        orderBy: { reviewVersion: "desc" },
        where: { extractionRunId: runId, targetId, targetType },
      });
      const review = await transaction.extractionReview.create({
        data: {
          action: input.action,
          actorUserId,
          correctedValue: input.corrected_value ?? null,
          extractionRunId: runId,
          organisationId,
          previousValue: latest?.correctedValue ?? null,
          reason: input.reason,
          reviewVersion: (latest?.reviewVersion ?? 0) + 1,
          targetId,
          targetType,
        },
      });
      const reviewState =
        input.action === "ACCEPT"
          ? "ACCEPTED"
          : input.action === "REJECT"
            ? "REJECTED"
            : input.action === "CORRECT" || input.action === "RESOLVE_CONFLICT"
              ? "CORRECTED"
              : "HUMAN_REVIEW_REQUIRED";
      if (targetType === "FIELD")
        await transaction.extractedTenderField.update({
          data: { reviewState },
          where: { id: targetId },
        });
      else
        await transaction.structuredRequirement.update({
          data: { reviewState },
          where: { id: targetId },
        });
      await transaction.auditEvent.create({
        data: {
          actorUserId,
          eventType:
            input.action === "CORRECT"
              ? "EXTRACTION_CORRECTION_CREATED"
              : input.action === "RESOLVE_CONFLICT"
                ? "EXTRACTION_CONFLICT_RESOLVED"
                : targetType === "FIELD"
                  ? "EXTRACTION_FIELD_REVIEWED"
                  : "EXTRACTION_REQUIREMENT_REVIEWED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: targetId,
          subjectType: `extraction_${targetType.toLowerCase()}`,
          metadata: { action: input.action, extraction_run_id: runId },
        },
      });
      return review;
    });
  }

  public async cancel(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const updated = await this.database.extractionRun.updateMany({
      data: {
        cancellationRequestedAt: new Date(),
        currentStage: "CANCELLED",
        eventSequence: { increment: 1 },
        publicMessage: "Extraction cancelled",
        status: "CANCELLED",
      },
      where: {
        id: runId,
        organisationId,
        status: { in: ["QUEUED", "PARSING", "STRUCTURING"] },
        tenderId,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException("Extraction cannot be cancelled");
    const queuedJob = await this.jobs.getJob(runId);
    if (queuedJob !== undefined && !(await queuedJob.isActive()))
      await queuedJob.remove();
    await this.database.auditEvent.create({
      data: {
        actorUserId: userId,
        eventType: "EXTRACTION_CANCELLED",
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: runId,
        subjectType: "extraction_run",
      },
    });
    return { state: "CANCELLED" };
  }

  public async retry(
    organisationId: string,
    tenderId: string,
    runId: string,
    userId: string,
    idempotencyKey: string,
    requestId: string,
  ): Promise<unknown> {
    const failed = await this.database.extractionRun.findFirst({
      where: { id: runId, organisationId, status: "FAILED", tenderId },
    });
    if (failed === null)
      throw new ConflictException("Only failed extraction runs may be retried");
    return this.start(
      organisationId,
      tenderId,
      failed.tenderVersionId,
      userId,
      idempotencyKey,
      requestId,
      "RETRY",
    );
  }

  public events(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let timer: NodeJS.Timeout | undefined;
      let active = true;
      let lastSequence: number | undefined;
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const poll = async (): Promise<void> => {
        try {
          if (Date.now() >= expiresAt) {
            subscriber.complete();
            return;
          }
          const run = await this.database.extractionRun.findFirst({
            select: {
              currentStage: true,
              eventSequence: true,
              id: true,
              progressPercentage: true,
              publicMessage: true,
              status: true,
              tenderVersionId: true,
              updatedAt: true,
            },
            where: { id: runId, organisationId, tenderId },
          });
          if (run === null) {
            subscriber.error(new NotFoundException());
            return;
          }
          const heartbeat = lastSequence === run.eventSequence;
          subscriber.next({
            data: heartbeat
              ? { timestamp: new Date().toISOString(), type: "heartbeat" }
              : { ...run, tender_id: tenderId },
            id: String(run.eventSequence),
            type: heartbeat ? "heartbeat" : "progress",
          });
          lastSequence = run.eventSequence;
          if (
            ["CANCELLED", "COMPLETE", "FAILED", "INVALIDATED"].includes(
              run.status,
            )
          ) {
            subscriber.complete();
            return;
          }
          if (active) timer = setTimeout(() => void poll(), 2000);
        } catch (error: unknown) {
          subscriber.error(error);
        }
      };
      void poll();
      return () => {
        active = false;
        if (timer !== undefined) clearTimeout(timer);
      };
    });
  }

  private async requireVersion(
    organisationId: string,
    tenderId: string,
    versionId: string,
  ): Promise<void> {
    const count = await this.database.tenderVersion.count({
      where: { id: versionId, tender: { id: tenderId, organisationId } },
    });
    if (count !== 1) throw new NotFoundException();
  }

  private async requireRun(
    organisationId: string,
    tenderId: string,
    runId: string,
  ): Promise<void> {
    const count = await this.database.extractionRun.count({
      where: { id: runId, organisationId, tenderId },
    });
    if (count !== 1) throw new NotFoundException();
  }

  private async requireTarget(
    organisationId: string,
    tenderId: string,
    runId: string,
    targetType: "FIELD" | "REQUIREMENT",
    targetId: string,
  ): Promise<void> {
    const where = {
      extractionRun: { organisationId, tenderId },
      extractionRunId: runId,
      id: targetId,
    };
    const count =
      targetType === "FIELD"
        ? await this.database.extractedTenderField.count({ where })
        : await this.database.structuredRequirement.count({ where });
    if (count !== 1) throw new NotFoundException();
  }

  private reviewHistory(
    runId: string,
    targetType: "FIELD" | "REQUIREMENT",
    targetId: string,
  ): Promise<unknown> {
    return this.database.extractionReview.findMany({
      orderBy: { reviewVersion: "asc" },
      select: {
        action: true,
        actorUserId: true,
        correctedValue: true,
        createdAt: true,
        id: true,
        previousValue: true,
        reason: true,
        reviewVersion: true,
      },
      where: { extractionRunId: runId, targetId, targetType },
    });
  }
}

function publicRun(run: {
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly currentStage: string;
  readonly eventSequence: number;
  readonly failureCategory: string | null;
  readonly id: string;
  readonly parserPolicyVersion: string;
  readonly progressPercentage: number;
  readonly publicMessage: string;
  readonly qualitySummary: unknown;
  readonly safeFailureMessage: string | null;
  readonly sourceFingerprint: string;
  readonly startedAt: Date | null;
  readonly status: string;
  readonly structuringPolicyVersion: string;
  readonly tenderVersionId: string;
  readonly triggerType: string;
  readonly updatedAt: Date;
}): Readonly<Record<string, unknown>> {
  return {
    completed_at: run.completedAt,
    created_at: run.createdAt,
    current_stage: run.currentStage,
    event_sequence: run.eventSequence,
    failure_category: run.failureCategory,
    id: run.id,
    parser_policy_version: run.parserPolicyVersion,
    progress_percentage: run.progressPercentage,
    public_message: run.publicMessage,
    quality_summary: run.qualitySummary,
    safe_failure_message: run.safeFailureMessage,
    source_fingerprint: run.sourceFingerprint,
    started_at: run.startedAt,
    status: run.status,
    structuring_policy_version: run.structuringPolicyVersion,
    tender_version_id: run.tenderVersionId,
    trigger_type: run.triggerType,
    updated_at: run.updatedAt,
  };
}
