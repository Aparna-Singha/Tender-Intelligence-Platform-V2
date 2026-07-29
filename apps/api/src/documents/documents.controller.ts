import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  completeUploadSchema,
  createUploadSessionSchema,
  documentFilterSchema,
} from "@tender/contracts";

import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { DocumentsService } from "./documents.service.js";

@ApiCookieAuth("session")
@ApiTags("company documents")
@Controller("organisations/:organisationId/documents")
export class DocumentsController {
  public constructor(private readonly documents: DocumentsService) {}

  @RequireOrganisationPermission("DOCUMENT_READ")
  @Get()
  @ApiOperation({ summary: "List reusable company documents" })
  public list(
    @Param("organisationId") organisationId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.documents.list(
      organisationId,
      documentFilterSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("DOCUMENT_READ")
  @Get(":documentId")
  @ApiOperation({ summary: "Read document details and version history" })
  public details(
    @Param("organisationId") organisationId: string,
    @Param("documentId") documentId: string,
  ): Promise<unknown> {
    return this.documents.details(organisationId, documentId);
  }

  @RequireOrganisationPermission("DOCUMENT_UPLOAD")
  @Post("upload-sessions")
  @ApiBody({ schema: { type: "object" } })
  @ApiOperation({ summary: "Create a short-lived direct upload session" })
  public createUpload(
    @Param("organisationId") organisationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.documents.createUploadSession(
      organisationId,
      request.authenticatedUser.userId,
      createUploadSessionSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("DOCUMENT_UPLOAD")
  @Post("upload-sessions/:uploadSessionId/complete")
  @ApiOperation({
    summary: "Complete an upload and enqueue security processing",
  })
  public completeUpload(
    @Param("organisationId") organisationId: string,
    @Param("uploadSessionId") uploadSessionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.documents.completeUpload(
      organisationId,
      uploadSessionId,
      request.authenticatedUser.userId,
      completeUploadSchema.parse(body),
      request.id,
    );
  }

  @RequireOrganisationPermission("DOCUMENT_READ")
  @Post(":documentId/download")
  @ApiOperation({ summary: "Authorize and sign a private document download" })
  public download(
    @Param("organisationId") organisationId: string,
    @Param("documentId") documentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.documents.download(
      organisationId,
      documentId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("DOCUMENT_DELETE")
  @Delete(":documentId")
  @ApiOperation({ summary: "Request document deletion under retention policy" })
  public remove(
    @Param("organisationId") organisationId: string,
    @Param("documentId") documentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.documents.requestDeletion(
      organisationId,
      documentId,
      request.authenticatedUser.userId,
      request.id,
    );
  }
}
