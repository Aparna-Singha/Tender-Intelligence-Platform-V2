import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { askRagQuestionSchema, ragPaginationSchema } from "@tender/contracts";
import {
  RateLimited,
  RequireOrganisationPermission,
} from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { ConversationsService } from "./conversations.service.js";

@ApiCookieAuth("session")
@ApiTags("conversations")
@Controller("organisations/:organisationId/conversations")
export class ConversationsController {
  public constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequireOrganisationPermission("RAG_CONVERSATION_READ")
  @ApiOperation({
    summary: "List shared workspace and tender conversations by last activity",
  })
  public list(@Param("organisationId") org: string): Promise<unknown> {
    return this.conversations.list(
      org,
      ragPaginationSchema.parse({ limit: 100 }).limit,
    );
  }

  @Post()
  @RequireOrganisationPermission("RAG_CONVERSATION_CREATE")
  @ApiOperation({ summary: "Create a durable workspace conversation" })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { context: { type: "string", maxLength: 160 } },
    },
  })
  public create(
    @Param("organisationId") org: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = z
      .object({ context: z.string().trim().max(160).optional() })
      .strict()
      .parse(body);
    return this.conversations.create(
      org,
      request.authenticatedUser.userId,
      input.context,
    );
  }

  @Get(":id")
  @RequireOrganisationPermission("RAG_CONVERSATION_READ")
  public load(
    @Param("organisationId") org: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<unknown> {
    return this.conversations.load(org, id);
  }

  @Patch(":id")
  @RequireOrganisationPermission("RAG_CONVERSATION_ARCHIVE")
  @ApiOperation({ summary: "Update conversation pin, title or archived state" })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pinned: { type: "boolean" },
        title: { type: "string", minLength: 1, maxLength: 160 },
        archived: { type: "boolean" },
      },
    },
  })
  public update(
    @Param("organisationId") org: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const input = z
      .object({
        pinned: z.boolean().optional(),
        title: z.string().trim().min(1).max(160).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .parse(body);
    return this.conversations.update(org, id, input);
  }

  @Post(":id/messages")
  @RequireOrganisationPermission("RAG_QUESTION_ASK")
  @RateLimited({ limit: 30, scope: "workspace-question", windowSeconds: 60 })
  @ApiOperation({
    summary:
      "Persist a workspace question and record-grounded answer atomically",
  })
  @ApiBody({
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["question", "idempotency_key"],
      properties: {
        question: { type: "string", minLength: 1, maxLength: 2000 },
        idempotency_key: { type: "string", minLength: 8, maxLength: 120 },
      },
    },
  })
  public send(
    @Param("organisationId") org: string,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = askRagQuestionSchema.parse(body);
    return this.conversations.send(
      org,
      id,
      input.question,
      input.idempotency_key,
      request.authenticatedUser.userId,
    );
  }
}
