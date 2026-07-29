import {
  Body,
  Controller,
  Delete,
  Get,
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
  completeTenderUploadSchema,
  createCorrigendumSchema,
  createTenderSchema,
  createTenderUploadSchema,
  importTenderSchema,
  updateTenderSchema,
} from "@tender/contracts";
import { Observable } from "rxjs";

import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { TendersService } from "./tenders.service.js";

@ApiCookieAuth("session")
@ApiTags("tenders")
@Controller("organisations/:organisationId/tenders")
export class TendersController {
  public constructor(private readonly tenders: TendersService) {}

  @RequireOrganisationPermission("TENDER_READ")
  @Get()
  @ApiOperation({ summary: "List organisation tender workspaces" })
  public list(
    @Param("organisationId") organisationId: string,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.tenders.list(organisationId, cursor);
  }

  @RequireOrganisationPermission("TENDER_CREATE")
  @Post()
  @ApiOperation({ summary: "Create a manual tender workspace" })
  public create(
    @Param("organisationId") organisationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.tenders.create(
      organisationId,
      request.authenticatedUser.userId,
      createTenderSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_ADMIN_IMPORT")
  @Post("imports")
  @ApiOperation({ summary: "Import a curated or administrator tender source" })
  public importTender(
    @Param("organisationId") organisationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.tenders.import(
      organisationId,
      request.authenticatedUser.userId,
      importTenderSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_READ")
  @Get(":tenderId")
  public get(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
  ): Promise<unknown> {
    return this.tenders.get(organisationId, tenderId);
  }

  @RequireOrganisationPermission("TENDER_READ")
  @Get(":tenderId/versions")
  public listVersions(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.tenders.listVersions(organisationId, tenderId, cursor);
  }

  @RequireOrganisationPermission("TENDER_READ")
  @Get(":tenderId/versions/:versionId")
  public getVersion(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.tenders.getVersion(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("TENDER_READ")
  @Get(":tenderId/documents")
  public listDocuments(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Query("cursor") cursor?: string,
  ): Promise<unknown> {
    return this.tenders.listDocuments(organisationId, tenderId, cursor);
  }

  @RequireOrganisationPermission("TENDER_UPDATE")
  @Patch(":tenderId")
  public update(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.tenders.update(
      organisationId,
      tenderId,
      request.authenticatedUser.userId,
      updateTenderSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_UPLOAD")
  @Post(":tenderId/versions/:versionId/upload-sessions")
  public createUpload(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.tenders.createUpload(
      organisationId,
      tenderId,
      versionId,
      request.authenticatedUser.userId,
      createTenderUploadSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_UPLOAD")
  @Post(":tenderId/documents/:documentId/complete")
  public completeUpload(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("documentId") documentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = completeTenderUploadSchema.parse(body);
    return this.tenders.completeUpload(
      organisationId,
      tenderId,
      documentId,
      request.authenticatedUser.userId,
      input.checksum_sha256,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_CORRIGENDUM_CREATE")
  @Post(":tenderId/corrigenda")
  public addCorrigendum(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.tenders.addCorrigendum(
      organisationId,
      tenderId,
      request.authenticatedUser.userId,
      createCorrigendumSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_READ")
  @Post(":tenderId/documents/:documentId/download")
  public download(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("documentId") documentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.tenders.download(
      organisationId,
      tenderId,
      documentId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_READ")
  @Get(":tenderId/jobs/:jobId")
  public job(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("jobId") jobId: string,
  ): Promise<unknown> {
    return this.tenders.job(organisationId, tenderId, jobId);
  }

  @RequireOrganisationPermission("TENDER_READ")
  @Sse(":tenderId/jobs/:jobId/events")
  public jobEvents(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("jobId") jobId: string,
  ): Observable<MessageEvent> {
    return this.tenders.jobEvents(organisationId, tenderId, jobId);
  }

  @RequireOrganisationPermission("TENDER_JOB_CANCEL")
  @Delete(":tenderId/jobs/:jobId")
  public cancelJob(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("jobId") jobId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.tenders.cancelJob(
      organisationId,
      tenderId,
      jobId,
      request.authenticatedUser.userId,
      request.id,
    );
  }
}
