import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Sse,
  type MessageEvent,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  extractionPaginationSchema,
  requirementFilterSchema,
  reviewExtractionSchema,
  startExtractionSchema,
} from "@tender/contracts";
import { Observable } from "rxjs";
import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { ExtractionsService } from "./extractions.service.js";

@ApiCookieAuth("session")
@ApiTags("tender extraction")
@Controller("organisations/:organisationId/tenders/:tenderId")
export class ExtractionsController {
  public constructor(private readonly extractions: ExtractionsService) {}

  @RequireOrganisationPermission("TENDER_EXTRACTION_START")
  @Post("versions/:versionId/extractions")
  @HttpCode(202)
  @ApiOperation({ summary: "Start deterministic extraction asynchronously" })
  public start(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startExtractionSchema.parse(body);
    return this.extractions.start(
      organisationId,
      tenderId,
      versionId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("versions/:versionId/extractions")
  public listRuns(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.extractions.listRuns(
      organisationId,
      tenderId,
      versionId,
      extractionPaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId")
  public getRun(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.extractions.getRun(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/status")
  public status(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.extractions.getRun(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/quality")
  public quality(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.extractions.quality(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/units")
  public units(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.extractions.listUnits(
      organisationId,
      tenderId,
      runId,
      extractionPaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/blocks")
  public blocks(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.extractions.listBlocks(
      organisationId,
      tenderId,
      runId,
      extractionPaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/sections")
  public sections(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.extractions.listSections(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/fields")
  public fields(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.extractions.listFields(
      organisationId,
      tenderId,
      runId,
      extractionPaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/fields/:fieldId")
  public field(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("fieldId") fieldId: string,
  ): Promise<unknown> {
    return this.extractions.getField(organisationId, tenderId, runId, fieldId);
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/requirements")
  public requirements(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.extractions.listRequirements(
      organisationId,
      tenderId,
      runId,
      requirementFilterSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/requirements/:requirementId")
  public requirement(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("requirementId") requirementId: string,
  ): Promise<unknown> {
    return this.extractions.getRequirement(
      organisationId,
      tenderId,
      runId,
      requirementId,
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Get("extractions/:runId/issues")
  public issues(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.extractions.issues(
      organisationId,
      tenderId,
      runId,
      extractionPaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_REVIEW")
  @Post("extractions/:runId/fields/:fieldId/reviews")
  public reviewField(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("fieldId") fieldId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.extractions.review(
      organisationId,
      tenderId,
      runId,
      "FIELD",
      fieldId,
      reviewExtractionSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_REVIEW")
  @Post("extractions/:runId/requirements/:requirementId/reviews")
  public reviewRequirement(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("requirementId") requirementId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.extractions.review(
      organisationId,
      tenderId,
      runId,
      "REQUIREMENT",
      requirementId,
      reviewExtractionSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_CANCEL")
  @Delete("extractions/:runId")
  public cancel(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.extractions.cancel(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_ADMIN_RETRY")
  @Post("extractions/:runId/retry")
  @HttpCode(202)
  public retry(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startExtractionSchema.parse(body);
    return this.extractions.retry(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_EXTRACTION_READ")
  @Sse("extractions/:runId/events")
  public events(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Observable<MessageEvent> {
    return this.extractions.events(organisationId, tenderId, runId);
  }
}
