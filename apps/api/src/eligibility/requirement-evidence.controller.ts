import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  attachRequirementEvidenceSchema,
  completeUploadSchema,
  createRequirementUploadSchema,
  evidenceCandidateFilterSchema,
} from "@tender/contracts";
import { hasPermission, type Permission } from "@tender/domain";
import { z } from "zod";
import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { RequirementEvidenceService } from "./requirement-evidence.service.js";
import type { RequirementScope } from "./requirement-evidence-scope.js";

@ApiCookieAuth("session")
@ApiTags("requirement evidence")
@Controller(
  "organisations/:organisationId/tenders/:tenderId/versions/:versionId/requirements/:requirementId",
)
export class RequirementEvidenceController {
  public constructor(private readonly evidence: RequirementEvidenceService) {}

  @RequireOrganisationPermission("DOCUMENT_UPLOAD")
  @Post("upload-sessions")
  @ApiOperation({
    summary:
      "Create a private requirement evidence upload and pending attachment",
  })
  public createUpload(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    this.require(request, "COMPANY_EVIDENCE_LINK");
    return this.evidence.createUpload(
      this.scope(params),
      request.authenticatedUser.userId,
      createRequirementUploadSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("DOCUMENT_UPLOAD")
  @Post("upload-sessions/:uploadSessionId/complete")
  @ApiOperation({
    summary:
      "Verify an uploaded object and enqueue its existing security processing",
  })
  public complete(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    this.require(request, "COMPANY_EVIDENCE_LINK");
    return this.evidence.completeUpload(
      this.scope(params),
      z.uuid().parse(params.uploadSessionId),
      request.authenticatedUser.userId,
      completeUploadSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("DOCUMENT_UPLOAD")
  @Delete("upload-sessions/:uploadSessionId")
  @ApiOperation({ summary: "Abandon a pending requirement evidence upload" })
  public abandon(
    @Param() params: Record<string, string>,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    this.require(request, "COMPANY_EVIDENCE_LINK");
    return this.evidence.abandonUpload(
      this.scope(params),
      z.uuid().parse(params.uploadSessionId),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("DOCUMENT_READ")
  @Get("evidence-candidates")
  @ApiOperation({
    summary:
      "List eligible organisation documents without signed URLs or compliance claims",
  })
  public candidates(
    @Param() params: Record<string, string>,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    this.require(request, "ELIGIBILITY_ASSESSMENT_READ");
    return this.evidence.candidates(
      this.scope(params),
      evidenceCandidateFilterSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_READ")
  @Get("attachments")
  @ApiOperation({
    summary: "List current and historical requirement evidence attachments",
  })
  public list(@Param() params: Record<string, string>): Promise<unknown> {
    return this.evidence.list(this.scope(params));
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_READ")
  @Get("attachments/:attachmentId")
  @ApiOperation({
    summary: "Read exact attachment, upload and document status",
  })
  public get(@Param() params: Record<string, string>): Promise<unknown> {
    return this.evidence.get(
      this.scope(params),
      z.uuid().parse(params.attachmentId),
    );
  }

  @RequireOrganisationPermission("DOCUMENT_READ")
  @Post("attachments/:attachmentId/download")
  @ApiOperation({
    summary:
      "Sign a short-lived download for the exact attached document version",
  })
  public download(
    @Param() params: Record<string, string>,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    this.require(request, "ELIGIBILITY_ASSESSMENT_READ");
    return this.evidence.downloadAttachment(
      this.scope(params),
      z.uuid().parse(params.attachmentId),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_LINK")
  @Post("attachments")
  @ApiOperation({
    summary: "Attach an existing approved private document version as context",
  })
  public attach(
    @Param() params: Record<string, string>,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    this.require(request, "DOCUMENT_READ");
    return this.evidence.attachExisting(
      this.scope(params),
      attachRequirementEvidenceSchema.parse(body),
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_LINK")
  @Delete("attachments/:attachmentId")
  @ApiOperation({
    summary:
      "Detach requirement evidence while retaining its history and source",
  })
  public detach(
    @Param() params: Record<string, string>,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.evidence.detach(
      this.scope(params),
      z.uuid().parse(params.attachmentId),
      request.authenticatedUser.userId,
    );
  }

  private scope(params: Record<string, string>): RequirementScope {
    return {
      organisationId: z.uuid().parse(params.organisationId),
      tenderId: z.uuid().parse(params.tenderId),
      tenderVersionId: z.uuid().parse(params.versionId),
      requirementId: z.uuid().parse(params.requirementId),
    };
  }

  private require(request: AuthenticatedRequest, permission: Permission): void {
    if (
      !request.organisationPrincipal ||
      !hasPermission(request.organisationPrincipal.role, permission)
    )
      throw new ForbiddenException();
  }
}
