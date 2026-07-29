import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type MessageEvent,
} from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";
import type {
  CreateRagConversationRequest,
  RagFeedbackRequest,
  RagSourceMode,
} from "@tender/contracts";
import type { PrismaClient } from "@tender/database";
import {
  RAG_ANSWER_POLICY_VERSION,
  RAG_CHUNK_POLICY_VERSION,
  RAG_EMBEDDING_DIMENSIONS,
  RAG_RETRIEVAL_POLICY_VERSION,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { Observable, concat, from, interval, takeUntil } from "rxjs";
import {
  API_ENVIRONMENT,
  JOB_QUEUE,
  PRISMA_CLIENT,
} from "../infrastructure.tokens.js";

@Injectable()
export class RagService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(JOB_QUEUE) private readonly jobs: Queue,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  public async startIndex(
    organisationId: string,
    tenderId: string,
    versionId: string,
    sourceMode: RagSourceMode,
    clientKey: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const version = await this.database.tenderVersion.findFirst({
      include: {
        activeEarlyRiskRun: true,
        activeEligibilityAssessmentRun: true,
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
    if (extraction?.status !== "COMPLETE" || extraction.invalidatedAt !== null)
      throw new UnprocessableEntityException(
        "A current completed extraction is required",
      );
    const derivedMode =
      sourceMode === "TENDER_AND_DERIVED_WORKFLOW_RECORDS" ||
      sourceMode === "FULL_AUTHORISED_TENDER_CONTEXT";
    if (
      derivedMode &&
      (version.activeEarlyRiskRun?.status !== "COMPLETE" ||
        version.activeEarlyRiskRun.invalidatedAt !== null ||
        version.activeEligibilityAssessmentRun?.status !== "COMPLETE" ||
        version.activeEligibilityAssessmentRun.invalidatedAt !== null)
    )
      throw new ConflictException(
        "Current derived workflow records are required for this source mode",
      );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          checklist: await this.currentChecklistFingerprint(
            organisationId,
            tenderId,
            versionId,
            derivedMode,
          ),
          eligibility: derivedMode
            ? version.activeEligibilityAssessmentRun?.sourceFingerprint
            : null,
          extraction: extraction.sourceFingerprint,
          companyEvidence: await this.currentCompanyEvidenceFingerprint(
            organisationId,
            sourceMode === "TENDER_AND_APPROVED_COMPANY_EVIDENCE" ||
              sourceMode === "FULL_AUTHORISED_TENDER_CONTEXT",
          ),
          mode: sourceMode,
          policies: [RAG_CHUNK_POLICY_VERSION, RAG_RETRIEVAL_POLICY_VERSION],
          risk: derivedMode
            ? version.activeEarlyRiskRun?.sourceFingerprint
            : null,
        }),
      )
      .digest("hex");
    const idempotencyKey = `${organisationId}:${clientKey}:${fingerprint}`;
    const existing = await this.database.ragIndexRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return existing;
    const run = await this.database.$transaction(async (transaction) => {
      const created = await transaction.ragIndexRun.create({
        data: {
          chunkPolicyVersion: RAG_CHUNK_POLICY_VERSION,
          embeddingDimensions: RAG_EMBEDDING_DIMENSIONS,
          embeddingModel: this.environment.RAG_EMBEDDING_MODEL,
          embeddingProvider: this.environment.RAG_PROVIDER,
          extractionRunId: extraction.id,
          idempotencyKey,
          organisationId,
          requestedByUserId: userId,
          retrievalPolicyVersion: RAG_RETRIEVAL_POLICY_VERSION,
          sourceFingerprint: fingerprint,
          sourceMode,
          tenderId,
          tenderVersionId: versionId,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "RAG_INDEX_STARTED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: created.id,
          subjectType: "rag_index_run",
        },
      });
      return created;
    });
    await this.jobs.add(
      "index-tender-rag",
      {
        indexRunId: run.id,
        kind: "INDEX",
        organisationId,
        requestId,
      },
      {
        attempts: 2,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `rag-index-${run.id}`,
        removeOnComplete: 100,
      },
    );
    return run;
  }

  public indexes(organisationId: string, tenderId: string): Promise<unknown> {
    return this.database.ragIndexRun.findMany({
      orderBy: { createdAt: "desc" },
      where: { organisationId, tenderId },
    });
  }

  public async index(
    organisationId: string,
    tenderId: string,
    indexRunId: string,
  ): Promise<unknown> {
    const run = await this.database.ragIndexRun.findFirst({
      where: { id: indexRunId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async cancelIndex(
    organisationId: string,
    tenderId: string,
    indexRunId: string,
  ): Promise<unknown> {
    const result = await this.database.ragIndexRun.updateMany({
      data: {
        cancellationRequestedAt: new Date(),
        currentStage: "Cancelled",
        status: "CANCELLED",
      },
      where: {
        id: indexRunId,
        organisationId,
        status: {
          in: ["QUEUED", "CHUNKING", "EMBEDDING", "INDEXING", "VALIDATING"],
        },
        tenderId,
      },
    });
    if (result.count !== 1)
      throw new ConflictException("Index cannot be cancelled");
    return { cancelled: true };
  }

  public async createConversation(
    organisationId: string,
    tenderId: string,
    input: CreateRagConversationRequest,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const tender = await this.database.tender.findFirst({
      where: {
        currentVersionId: { not: null },
        deletedAt: null,
        id: tenderId,
        organisationId,
      },
    });
    if (tender?.currentVersionId === null || tender === null)
      throw new NotFoundException();
    const index = await this.database.ragIndexRun.findFirst({
      orderBy: { activatedAt: "desc" },
      where: {
        invalidatedAt: null,
        organisationId,
        sourceMode: input.source_mode,
        status: "COMPLETE",
        tenderId,
        tenderVersionId: tender.currentVersionId,
      },
    });
    if (index === null)
      throw new ConflictException(
        "A current completed index is required for this source mode",
      );
    return this.database.$transaction(async (transaction) => {
      const conversation = await transaction.ragConversation.create({
        data: {
          createdByUserId: userId,
          indexRunId: index.id,
          organisationId,
          sourceMode: input.source_mode,
          tenderId,
          tenderVersionId: tender.currentVersionId!,
          title: input.title,
        },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "RAG_CONVERSATION_CREATED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: conversation.id,
          subjectType: "rag_conversation",
        },
      });
      return conversation;
    });
  }

  public conversations(
    organisationId: string,
    tenderId: string,
    limit: number,
  ): Promise<unknown> {
    return this.database.ragConversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      where: { deletedAt: null, organisationId, tenderId },
    });
  }

  public async conversation(
    organisationId: string,
    tenderId: string,
    conversationId: string,
  ): Promise<unknown> {
    const conversation = await this.database.ragConversation.findFirst({
      include: {
        answerRuns: {
          include: { citations: true },
          orderBy: { createdAt: "asc" },
        },
        messages: { orderBy: { sequence: "asc" }, take: 100 },
      },
      where: {
        deletedAt: null,
        id: conversationId,
        organisationId,
        tenderId,
      },
    });
    if (conversation === null) throw new NotFoundException();
    return conversation;
  }

  public async ask(
    organisationId: string,
    tenderId: string,
    conversationId: string,
    question: string,
    clientKey: string,
    userId: string,
    requestId: string,
  ): Promise<unknown> {
    const conversation = await this.database.ragConversation.findFirst({
      include: { indexRun: true },
      where: {
        deletedAt: null,
        id: conversationId,
        organisationId,
        status: "ACTIVE",
        tenderId,
      },
    });
    if (conversation === null) throw new NotFoundException();
    if (
      conversation.indexRun.status !== "COMPLETE" ||
      conversation.indexRun.invalidatedAt !== null
    )
      throw new ConflictException(
        "This conversation source index is no longer current",
      );
    const idempotencyKey = `${organisationId}:${conversationId}:${clientKey}`;
    const existing = await this.database.ragAnswerRun.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) return existing;
    const run = await this.database.$transaction(async (transaction) => {
      const sequence = await transaction.ragMessage.count({
        where: { conversationId, organisationId, tenderId },
      });
      const message = await transaction.ragMessage.create({
        data: {
          content: question,
          conversationId,
          createdByUserId: userId,
          organisationId,
          role: "USER",
          sequence: sequence + 1,
          tenderId,
        },
      });
      return transaction.ragAnswerRun.create({
        data: {
          answerPolicyVersion: RAG_ANSWER_POLICY_VERSION,
          conversationId,
          idempotencyKey,
          indexRunId: conversation.indexRunId,
          model: this.environment.RAG_CHAT_MODEL,
          organisationId,
          provider: this.environment.RAG_PROVIDER,
          questionMessageId: message.id,
          retrievalPolicyVersion: RAG_RETRIEVAL_POLICY_VERSION,
          sourceMode: conversation.sourceMode,
          tenderId,
          tenderVersionId: conversation.tenderVersionId,
        },
      });
    });
    await this.jobs.add(
      "answer-tender-rag",
      {
        answerRunId: run.id,
        kind: "ANSWER",
        organisationId,
        requestId,
      },
      {
        attempts: 2,
        backoff: { delay: 2_000, type: "exponential" },
        jobId: `rag-answer-${run.id}`,
        removeOnComplete: 100,
      },
    );
    return run;
  }

  public async answerRun(
    organisationId: string,
    tenderId: string,
    answerRunId: string,
  ): Promise<unknown> {
    const run = await this.database.ragAnswerRun.findFirst({
      include: { answerMessage: true, citations: true },
      where: { id: answerRunId, organisationId, tenderId },
    });
    if (run === null) throw new NotFoundException();
    return run;
  }

  public async cancelAnswer(
    organisationId: string,
    tenderId: string,
    answerRunId: string,
  ): Promise<unknown> {
    const result = await this.database.ragAnswerRun.updateMany({
      data: {
        cancellationRequestedAt: new Date(),
        currentStage: "Cancelled",
        status: "CANCELLED",
      },
      where: {
        id: answerRunId,
        organisationId,
        status: {
          in: ["QUEUED", "RETRIEVING", "GENERATING", "VERIFYING_CITATIONS"],
        },
        tenderId,
      },
    });
    if (result.count !== 1)
      throw new ConflictException("Answer cannot be cancelled");
    return { cancelled: true };
  }

  public events(
    organisationId: string,
    tenderId: string,
    answerRunId: string,
  ): Observable<MessageEvent> {
    const stream = new Observable<MessageEvent>((subscriber) => {
      const timer = setInterval(() => {
        void this.database.ragAnswerRun
          .findFirst({
            select: {
              completedAt: true,
              currentStage: true,
              failureCode: true,
              progressPercentage: true,
              status: true,
            },
            where: { id: answerRunId, organisationId, tenderId },
          })
          .then((run) => {
            if (run === null) {
              subscriber.error(new NotFoundException());
              return;
            }
            subscriber.next({ data: run, type: "progress" });
            if (
              [
                "COMPLETE",
                "INSUFFICIENT_EVIDENCE",
                "HUMAN_REVIEW_REQUIRED",
                "FAILED",
                "CANCELLED",
                "INVALIDATED",
              ].includes(run.status)
            ) {
              clearInterval(timer);
              subscriber.complete();
            }
          });
      }, 1_000);
      return () => clearInterval(timer);
    });
    return concat(
      from([{ data: { status: "CONNECTED" }, type: "connected" }]),
      stream.pipe(takeUntil(interval(300_000))),
    );
  }

  public async feedback(
    organisationId: string,
    tenderId: string,
    answerRunId: string,
    input: RagFeedbackRequest,
    userId: string,
  ): Promise<unknown> {
    await this.answerRun(organisationId, tenderId, answerRunId);
    return this.database.ragFeedback.upsert({
      create: {
        answerRunId,
        comment: input.comment ?? null,
        organisationId,
        rating: input.rating,
        reasonCode: input.reason_code ?? null,
        submittedByUserId: userId,
        tenderId,
      },
      update: {
        comment: input.comment ?? null,
        rating: input.rating,
        reasonCode: input.reason_code ?? null,
      },
      where: {
        answerRunId_submittedByUserId: {
          answerRunId,
          submittedByUserId: userId,
        },
      },
    });
  }

  public async archive(
    organisationId: string,
    tenderId: string,
    conversationId: string,
  ): Promise<unknown> {
    const result = await this.database.ragConversation.updateMany({
      data: { archivedAt: new Date(), status: "ARCHIVED" },
      where: {
        id: conversationId,
        organisationId,
        status: "ACTIVE",
        tenderId,
      },
    });
    if (result.count !== 1) throw new NotFoundException();
    return { archived: true };
  }

  public async deleteConversation(
    organisationId: string,
    tenderId: string,
    conversationId: string,
  ): Promise<unknown> {
    const result = await this.database.ragConversation.updateMany({
      data: { deletedAt: new Date(), status: "DELETED" },
      where: { deletedAt: null, id: conversationId, organisationId, tenderId },
    });
    if (result.count !== 1) throw new NotFoundException();
    return { deleted: true };
  }

  private async currentChecklistFingerprint(
    organisationId: string,
    tenderId: string,
    versionId: string,
    include: boolean,
  ): Promise<string | null> {
    if (!include) return null;
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
    return run?.sourceFingerprint ?? null;
  }

  private async currentCompanyEvidenceFingerprint(
    organisationId: string,
    include: boolean,
  ): Promise<string | null> {
    if (!include) return null;
    const facts = await this.database.companyEvidenceFact.findMany({
      include: {
        currentVersion: {
          include: {
            citations: {
              select: {
                documentChecksum: true,
                id: true,
                invalidatedAt: true,
                validationStatus: true,
              },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      where: {
        invalidatedAt: null,
        organisationId,
        currentVersion: { reviewState: "ACCEPTED" },
      },
    });
    return createHash("sha256")
      .update(
        JSON.stringify(
          facts.map((fact) => ({
            citations: fact.currentVersion?.citations,
            factId: fact.id,
            versionId: fact.currentVersionId,
          })),
        ),
      )
      .digest("hex");
  }
}
