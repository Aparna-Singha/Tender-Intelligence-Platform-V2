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
  createDraftHumanInputSchema,
  createDraftTemplateSchema,
  createDraftTemplateVersionSchema,
  draftPaginationSchema,
  draftReviewActionSchema,
  draftTypeSchema,
  editDraftVersionSchema,
  resolveDraftPlaceholderSchema,
  reviewDraftHumanInputSchema,
  startDraftGenerationSchema,
} from "@tender/contracts";
import { hasPermission } from "@tender/domain";
import type { Observable } from "rxjs";
import {
  RateLimited,
  RequireOrganisationPermission,
} from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { DraftsService } from "./drafts.service.js";

@ApiCookieAuth("session")
@ApiTags("fact-constrained tender drafting")
@Controller("organisations/:organisationId/tenders/:tenderId")
export class DraftsController {
  public constructor(private readonly drafts: DraftsService) {}

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("draft-templates")
  public templates(
    @Param("organisationId") organisationId: string,
    @Query("draft_type") draftType: string | undefined,
  ): Promise<unknown> {
    return this.drafts.templates(
      organisationId,
      draftType === undefined ? undefined : draftTypeSchema.parse(draftType),
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("draft-templates/:templateId")
  public template(
    @Param("organisationId") organisationId: string,
    @Param("templateId") templateId: string,
  ): Promise<unknown> {
    return this.drafts.template(organisationId, templateId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_TEMPLATE_MANAGE")
  @Post("draft-templates")
  public createTemplate(
    @Param("organisationId") organisationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.createTemplate(
      organisationId,
      createDraftTemplateSchema.parse(body),
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_TEMPLATE_MANAGE")
  @Post("draft-templates/:templateId/versions")
  public createTemplateVersion(
    @Param("organisationId") organisationId: string,
    @Param("templateId") templateId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.createTemplateVersion(
      organisationId,
      templateId,
      createDraftTemplateVersionSchema.parse(body),
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_TEMPLATE_MANAGE")
  @Delete("draft-templates/:templateId")
  public retireTemplate(
    @Param("organisationId") organisationId: string,
    @Param("templateId") templateId: string,
  ): Promise<unknown> {
    return this.drafts.retireTemplate(organisationId, templateId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_GENERATE")
  @RateLimited({ limit: 10, scope: "draft-generation", windowSeconds: 60 })
  @Post("draft-generation-runs")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Queue fact-constrained drafting after validating current Phase 5–9 authority",
  })
  public startGeneration(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startDraftGenerationSchema.parse(body);
    this.requireCompanyEvidencePermission(input.source_mode, request);
    return this.drafts.startGeneration(
      organisationId,
      tenderId,
      input,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("draft-generation-runs")
  public runs(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.drafts.runs(
      organisationId,
      tenderId,
      draftPaginationSchema.parse(query).limit,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("draft-generation-runs/active")
  public activeRun(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
  ): Promise<unknown> {
    return this.drafts.activeRun(organisationId, tenderId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("draft-generation-runs/:runId")
  public run(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.drafts.run(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_RETRY")
  @Post("draft-generation-runs/:runId/retry")
  @HttpCode(202)
  public retryRun(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.retryRun(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_CANCEL")
  @Delete("draft-generation-runs/:runId")
  public cancelRun(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.cancelRun(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Sse("draft-generation-runs/:runId/events")
  public events(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Observable<MessageEvent> {
    return this.drafts.events(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("drafts")
  public listDrafts(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.drafts.drafts(
      organisationId,
      tenderId,
      draftPaginationSchema.parse(query).limit,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("drafts/:draftId")
  public draft(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("draftId") draftId: string,
  ): Promise<unknown> {
    return this.drafts.draft(organisationId, tenderId, draftId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("drafts/:draftId/versions")
  public versions(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("draftId") draftId: string,
  ): Promise<unknown> {
    return this.drafts.versions(organisationId, tenderId, draftId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("drafts/:draftId/versions/:versionId")
  public version(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("draftId") draftId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.drafts.version(organisationId, tenderId, draftId, versionId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_EDIT")
  @Post("drafts/:draftId/versions/:versionId/edits")
  public editVersion(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("draftId") draftId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.editVersion(
      organisationId,
      tenderId,
      draftId,
      versionId,
      editDraftVersionSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("drafts/:draftId/compare")
  public compare(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("draftId") draftId: string,
    @Query("left") left: string,
    @Query("right") right: string,
  ): Promise<unknown> {
    return this.drafts.compareVersions(
      organisationId,
      tenderId,
      draftId,
      left,
      right,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_HUMAN_INPUT_CREATE")
  @Post("draft-human-inputs")
  public createHumanInput(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.createHumanInput(
      organisationId,
      tenderId,
      createDraftHumanInputSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("draft-human-inputs")
  public humanInputs(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
  ): Promise<unknown> {
    return this.drafts.humanInputs(organisationId, tenderId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_HUMAN_INPUT_REVIEW")
  @Patch("draft-human-inputs/:inputId/review")
  public reviewHumanInput(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("inputId") inputId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.reviewHumanInput(
      organisationId,
      tenderId,
      inputId,
      reviewDraftHumanInputSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_READ")
  @Get("draft-versions/:versionId/placeholders")
  public placeholders(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.drafts.placeholders(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("TENDER_DRAFT_EDIT")
  @Patch("draft-versions/:versionId/placeholders/:placeholderId/resolve")
  public resolvePlaceholder(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Param("placeholderId") placeholderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.resolvePlaceholder(
      organisationId,
      tenderId,
      versionId,
      placeholderId,
      resolveDraftPlaceholderSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_REVIEW")
  @Patch("draft-versions/:versionId/placeholders/:placeholderId/reopen")
  public reopenPlaceholder(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Param("placeholderId") placeholderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const parsed = draftReviewActionSchema
      .pick({ rationale: true })
      .parse(body);
    return this.drafts.reopenPlaceholder(
      organisationId,
      tenderId,
      versionId,
      placeholderId,
      parsed.rationale,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_REVIEW")
  @Post("drafts/:draftId/versions/:versionId/reviews")
  public review(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("draftId") draftId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = draftReviewActionSchema.parse(body);
    if (request.organisationPrincipal === undefined)
      throw new ForbiddenException("Organisation membership is required");
    return this.drafts.review(
      organisationId,
      tenderId,
      draftId,
      versionId,
      input,
      request.authenticatedUser.userId,
      request.id,
      request.organisationPrincipal.role,
      hasPermission(request.organisationPrincipal.role, "TENDER_DRAFT_APPROVE"),
    );
  }

  @RequireOrganisationPermission("TENDER_DRAFT_EDIT")
  @Patch("drafts/:draftId/archive")
  public archive(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("draftId") draftId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.drafts.archive(
      organisationId,
      tenderId,
      draftId,
      request.authenticatedUser.userId,
      request.id,
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
          "TENDER_DRAFT_USE_COMPANY_EVIDENCE",
        ))
    )
      throw new ForbiddenException();
  }
}
