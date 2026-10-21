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
import { Prisma, type PrismaClient } from "@tender/database";
import {
  RAG_ANSWER_POLICY_VERSION,
  RAG_CHUNK_POLICY_VERSION,
  RAG_EMBEDDING_DIMENSIONS,
  RAG_RETRIEVAL_POLICY_VERSION,
} from "@tender/domain";
import type { Queue } from "bullmq";
import { createHash, randomUUID } from "node:crypto";
import { conversationTitle } from "./conversations.service.js";
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
    const equivalent = await this.database.ragIndexRun.findFirst({
      orderBy: { createdAt: "desc" },
      where: {
        invalidatedAt: null,
        organisationId,
        sourceFingerprint: fingerprint,
        sourceMode,
        status: {
          in: [
            "QUEUED",
            "CHUNKING",
            "EMBEDDING",
            "INDEXING",
            "VALIDATING",
            "COMPLETE",
          ],
        },
        tenderId,
        tenderVersionId: versionId,
      },
    });
    if (equivalent !== null) return equivalent;
    const result = await this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${organisationId}:${tenderId}:${sourceMode}:${fingerprint}`}))::text AS acquired`,
      );
      const concurrent = await transaction.ragIndexRun.findFirst({
        orderBy: { createdAt: "desc" },
        where: {
          invalidatedAt: null,
          organisationId,
          sourceFingerprint: fingerprint,
          sourceMode,
          status: {
            in: [
              "QUEUED",
              "CHUNKING",
              "EMBEDDING",
              "INDEXING",
              "VALIDATING",
              "COMPLETE",
            ],
          },
          tenderId,
          tenderVersionId: versionId,
        },
      });
      if (concurrent !== null) return { created: false, run: concurrent };
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
      return { created: true, run: created };
    });
    if (result.created)
      await this.jobs.add(
        "index-tender-rag",
        {
          indexRunId: result.run.id,
          kind: "INDEX",
          organisationId,
          requestId,
        },
        {
          attempts: 2,
          backoff: { delay: 2_000, type: "exponential" },
          jobId: `rag-index-${result.run.id}`,
          removeOnComplete: 100,
        },
      );
    return result.run;
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
        messages: { orderBy: { sequence: "asc" } },
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
      conversation.indexRun === null ||
      conversation.indexRunId === null ||
      conversation.tenderVersionId === null ||
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
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM rag_conversations WHERE id=${conversationId}::uuid AND organisation_id=${organisationId}::uuid FOR UPDATE`,
      );
      const sequence = await transaction.ragMessage.count({
        where: { conversationId, organisationId, tenderId },
      });
      await transaction.ragConversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          ...(sequence === 0 ? { title: conversationTitle(question) } : {}),
        },
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
          indexRunId: conversation.indexRunId!,
          model: this.environment.RAG_CHAT_MODEL,
          organisationId,
          provider: this.environment.RAG_PROVIDER,
          questionMessageId: message.id,
          retrievalPolicyVersion: RAG_RETRIEVAL_POLICY_VERSION,
          sourceMode: conversation.sourceMode,
          tenderId,
          tenderVersionId: conversation.tenderVersionId!,
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

  /** Creates an immutable attempt under the same visible question. */
  public async retryAnswer(
    organisationId: string,
    tenderId: string,
    answerRunId: string,
    requestId: string,
  ): Promise<unknown> {
    const result = await this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT id FROM rag_answer_runs WHERE id=${answerRunId}::uuid AND organisation_id=${organisationId}::uuid FOR UPDATE`,
      );
      const run = await transaction.ragAnswerRun.findFirst({
        select: {
          answerPolicyVersion: true,
          conversationId: true,
          id: true,
          indexRunId: true,
          model: true,
          provider: true,
          questionMessageId: true,
          retrievalPolicyVersion: true,
          sourceMode: true,
          status: true,
          tenderVersionId: true,
        },
        where: { id: answerRunId, organisationId, tenderId },
      });
      if (run === null) throw new NotFoundException();
      if (
        ["QUEUED", "RETRIEVING", "GENERATING", "VERIFYING_CITATIONS"].includes(
          run.status,
        )
      )
        return { queued: false, run };
      if (
        !["FAILED", "INSUFFICIENT_EVIDENCE", "HUMAN_REVIEW_REQUIRED"].includes(
          run.status,
        )
      )
        throw new ConflictException("Answer cannot be retried");
      const priorRetry = await transaction.ragAnswerRun.findUnique({
        where: { retryOfRunId: answerRunId },
      });
      if (priorRetry !== null)
        return { queued: priorRetry.status === "QUEUED", run: priorRetry };
      const retry = await transaction.ragAnswerRun.create({
        data: {
          answerPolicyVersion: run.answerPolicyVersion,
          conversationId: run.conversationId,
          idempotencyKey: `${organisationId}:${run.conversationId}:retry:${randomUUID()}`,
          indexRunId: run.indexRunId,
          model: run.model,
          organisationId,
          provider: run.provider,
          questionMessageId: run.questionMessageId,
          retrievalPolicyVersion: run.retrievalPolicyVersion,
          retryOfRunId: run.id,
          sourceMode: run.sourceMode,
          tenderId,
          tenderVersionId: run.tenderVersionId,
        },
      });
      return { queued: true, run: retry };
    });
    if (result.queued) {
      await this.jobs.add(
        "answer-tender-rag",
        {
          answerRunId: result.run.id,
          kind: "ANSWER",
          organisationId,
          requestId,
        },
        {
          attempts: 2,
          backoff: { delay: 2_000, type: "exponential" },
          jobId: `rag-answer-${result.run.id}`,
          removeOnComplete: 100,
        },
      );
    }
    return result.run;
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
