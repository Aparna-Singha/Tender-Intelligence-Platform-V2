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
  checklistFilterSchema,
  startChecklistSchema,
  updateChecklistItemSchema,
} from "@tender/contracts";
import { hasPermission } from "@tender/domain";
import type { Observable } from "rxjs";
import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { ChecklistsService } from "./checklists.service.js";

@ApiCookieAuth("session")
@ApiTags("missing evidence and action checklist")
@Controller("organisations/:organisationId/tenders/:tenderId")
export class ChecklistsController {
  public constructor(private readonly checklists: ChecklistsService) {}

  @RequireOrganisationPermission("CHECKLIST_GENERATION_START")
  @Post("versions/:versionId/checklists")
  @HttpCode(202)
  @ApiOperation({
    summary: "Generate a checklist from the exact active Phase 7 run",
  })
  public start(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.checklists.start(
      organisationId,
      tenderId,
      versionId,
      request.authenticatedUser.userId,
      startChecklistSchema.parse(body).idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("CHECKLIST_GENERATION_READ")
  @Get("versions/:versionId/checklists")
  public runs(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.checklists.runs(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("CHECKLIST_GENERATION_READ")
  @Get("versions/:versionId/checklists/current")
  public current(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.checklists.current(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("CHECKLIST_GENERATION_READ")
  @Get("checklists/:runId")
  public run(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.checklists.run(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("CHECKLIST_ITEM_READ")
  @Get("checklists/:runId/items")
  public items(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.checklists.items(
      organisationId,
      tenderId,
      runId,
      checklistFilterSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("CHECKLIST_ITEM_READ")
  @Get("checklists/:runId/items/:itemId")
  public item(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("itemId") itemId: string,
  ): Promise<unknown> {
    return this.checklists.item(organisationId, tenderId, runId, itemId);
  }

  @RequireOrganisationPermission("CHECKLIST_ITEM_EDIT")
  @Patch("checklists/:runId/items/:itemId")
  public update(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = updateChecklistItemSchema.parse(body);
    const role = request.organisationPrincipal?.role;
    if (
      role === undefined ||
      (input.assignee_id !== undefined &&
        !hasPermission(role, "CHECKLIST_ITEM_ASSIGN")) ||
      (input.status === "RESOLVED" &&
        !hasPermission(role, "CHECKLIST_ITEM_RESOLVE")) ||
      (input.status === "DISMISSED" &&
        !hasPermission(role, "CHECKLIST_ITEM_DISMISS"))
    )
      throw new ForbiddenException();
    return this.checklists.update(
      organisationId,
      tenderId,
      runId,
      itemId,
      input,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("CHECKLIST_GENERATION_CANCEL")
  @Delete("checklists/:runId")
  public cancel(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.checklists.cancel(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("CHECKLIST_GENERATION_RETRY")
  @Post("checklists/:runId/retry")
  @HttpCode(202)
  public retry(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.checklists.retry(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      startChecklistSchema.parse(body).idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("CHECKLIST_GENERATION_READ")
  @Sse("checklists/:runId/events")
  public events(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Observable<MessageEvent> {
    return this.checklists.events(organisationId, tenderId, runId);
  }
}
