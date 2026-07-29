import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  type MessageEvent,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  askRagQuestionSchema,
  createRagConversationSchema,
  ragFeedbackSchema,
  ragPaginationSchema,
  startRagIndexSchema,
} from "@tender/contracts";
import { hasPermission } from "@tender/domain";
import type { Observable } from "rxjs";
import {
  RateLimited,
  RequireOrganisationPermission,
} from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { RagService } from "./rag.service.js";

@ApiCookieAuth("session")
@ApiTags("tender RAG chatbot")
@Controller("organisations/:organisationId/tenders/:tenderId")
export class RagController {
  public constructor(private readonly rag: RagService) {}

  @RequireOrganisationPermission("RAG_INDEX_START")
  @Post("versions/:versionId/rag-indexes")
  @HttpCode(202)
  @ApiOperation({ summary: "Queue an immutable tenant-scoped RAG index" })
  public startIndex(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startRagIndexSchema.parse(body);
    this.requireCompanyEvidencePermission(input.source_mode, request);
    return this.rag.startIndex(
      organisationId,
      tenderId,
      versionId,
      input.source_mode,
      input.idempotency_key,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("RAG_INDEX_READ")
  @Get("rag-indexes")
  public indexes(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
  ): Promise<unknown> {
    return this.rag.indexes(organisationId, tenderId);
  }

  @RequireOrganisationPermission("RAG_INDEX_READ")
  @Get("rag-indexes/:indexRunId")
  public index(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("indexRunId") indexRunId: string,
  ): Promise<unknown> {
    return this.rag.index(organisationId, tenderId, indexRunId);
  }

  @RequireOrganisationPermission("RAG_INDEX_CANCEL")
  @Delete("rag-indexes/:indexRunId")
  public cancelIndex(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("indexRunId") indexRunId: string,
  ): Promise<unknown> {
    return this.rag.cancelIndex(organisationId, tenderId, indexRunId);
  }

  @RequireOrganisationPermission("RAG_CONVERSATION_CREATE")
  @Post("rag-conversations")
  public createConversation(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = createRagConversationSchema.parse(body);
    this.requireCompanyEvidencePermission(input.source_mode, request);
    return this.rag.createConversation(
      organisationId,
      tenderId,
      input,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("RAG_CONVERSATION_READ")
  @Get("rag-conversations")
  public conversations(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    const { limit } = ragPaginationSchema.parse(query);
    return this.rag.conversations(organisationId, tenderId, limit);
  }

  @RequireOrganisationPermission("RAG_CONVERSATION_READ")
  @Get("rag-conversations/:conversationId")
  public conversation(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<unknown> {
    return this.rag.conversation(organisationId, tenderId, conversationId);
  }

  @RequireOrganisationPermission("RAG_QUESTION_ASK")
  @RateLimited({ limit: 30, scope: "rag-question", windowSeconds: 60 })
  @Post("rag-conversations/:conversationId/questions")
  @HttpCode(202)
  public ask(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("conversationId") conversationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = askRagQuestionSchema.parse(body);
    return this.rag.ask(
      organisationId,
      tenderId,
      conversationId,
      input.question,
      input.idempotency_key,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("RAG_CONVERSATION_READ")
  @Get("rag-answers/:answerRunId")
  public answer(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("answerRunId") answerRunId: string,
  ): Promise<unknown> {
    return this.rag.answerRun(organisationId, tenderId, answerRunId);
  }

  @RequireOrganisationPermission("RAG_QUESTION_ASK")
  @Delete("rag-answers/:answerRunId")
  public cancelAnswer(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("answerRunId") answerRunId: string,
  ): Promise<unknown> {
    return this.rag.cancelAnswer(organisationId, tenderId, answerRunId);
  }

  @RequireOrganisationPermission("RAG_CONVERSATION_READ")
  @Sse("rag-answers/:answerRunId/events")
  public events(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("answerRunId") answerRunId: string,
  ): Observable<MessageEvent> {
    return this.rag.events(organisationId, tenderId, answerRunId);
  }

  @RequireOrganisationPermission("RAG_FEEDBACK_CREATE")
  @Post("rag-answers/:answerRunId/feedback")
  public feedback(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("answerRunId") answerRunId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.rag.feedback(
      organisationId,
      tenderId,
      answerRunId,
      ragFeedbackSchema.parse(body),
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("RAG_CONVERSATION_ARCHIVE")
  @Patch("rag-conversations/:conversationId/archive")
  public archive(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<unknown> {
    return this.rag.archive(organisationId, tenderId, conversationId);
  }

  @RequireOrganisationPermission("RAG_CONVERSATION_ARCHIVE")
  @Delete("rag-conversations/:conversationId")
  public deleteConversation(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<unknown> {
    return this.rag.deleteConversation(
      organisationId,
      tenderId,
      conversationId,
    );
  }

  private requireCompanyEvidencePermission(
    mode: string,
    request: AuthenticatedRequest,
  ): void {
    if (
      (mode === "TENDER_AND_APPROVED_COMPANY_EVIDENCE" ||
        mode === "FULL_AUTHORISED_TENDER_CONTEXT") &&
      (request.organisationPrincipal === undefined ||
        !hasPermission(
          request.organisationPrincipal.role,
          "RAG_COMPANY_EVIDENCE_USE",
        ))
    )
      throw new ForbiddenException();
  }
}
