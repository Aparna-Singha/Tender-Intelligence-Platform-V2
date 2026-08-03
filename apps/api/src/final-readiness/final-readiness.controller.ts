import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  cancelFinalReadinessSchema,
  createFinalReadinessDispositionSchema,
  finalReadinessFindingFilterSchema,
  finalReadinessPaginationSchema,
  retryFinalReadinessSchema,
  reviewFinalReadinessFindingSchema,
  startFinalReadinessSchema,
} from "@tender/contracts";
import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { FinalReadinessService } from "./final-readiness.service.js";

@ApiCookieAuth("session")
@ApiTags("final readiness")
@Controller("organisations/:organisationId/tenders/:tenderId")
export class FinalReadinessController {
  public constructor(private readonly readiness: FinalReadinessService) {}

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("final-readiness/preflight")
  public preflight(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.readiness.preflight(
      organisationId,
      tenderId,
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_START")
  @Post("final-readiness")
  @HttpCode(202)
  public start(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startFinalReadinessSchema.parse(body);
    return this.readiness.start(
      organisationId,
      tenderId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("versions/:versionId/final-readiness/current")
  public current(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.readiness.current(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("versions/:versionId/final-readiness")
  public history(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.readiness.history(
      organisationId,
      tenderId,
      versionId,
      finalReadinessPaginationSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("final-readiness/:runId")
  public run(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.readiness.progress(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("final-readiness/:runId/events")
  public events(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.readiness.run(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("final-readiness/:runId/findings")
  public findings(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.readiness.findings(
      organisationId,
      tenderId,
      runId,
      finalReadinessFindingFilterSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("final-readiness/:runId/findings/:findingId")
  public finding(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("findingId") findingId: string,
  ): Promise<unknown> {
    return this.readiness.finding(organisationId, tenderId, runId, findingId);
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("final-readiness/:runId/findings/:findingId/reviews")
  public findingReviews(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("findingId") findingId: string,
  ): Promise<unknown> {
    return this.readiness.findingReviews(
      organisationId,
      tenderId,
      runId,
      findingId,
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_FINDING_REVIEW")
  @Post("final-readiness/:runId/findings/:findingId/reviews")
  public reviewFinding(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("findingId") findingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.readiness.reviewFinding(
      organisationId,
      tenderId,
      runId,
      findingId,
      reviewFinalReadinessFindingSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_DISPOSITION_CREATE")
  @Post("final-readiness/:runId/decisions")
  public disposition(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = createFinalReadinessDispositionSchema.parse(body);
    if (input.run_id !== runId) throw new NotFoundException();
    if (request.organisationPrincipal === undefined)
      throw new NotFoundException();
    return this.readiness.createDisposition(
      organisationId,
      tenderId,
      input,
      request.authenticatedUser.userId,
      request.organisationPrincipal.role,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_READ")
  @Get("final-readiness/:runId/decisions")
  public decisions(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.readiness.decisions(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_CANCEL")
  @Delete("final-readiness/:runId")
  public cancel(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = cancelFinalReadinessSchema.parse(body);
    if (input.run_id !== runId) throw new NotFoundException();
    return this.readiness.cancel(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_FINAL_READINESS_RETRY")
  @Post("final-readiness/:runId/retry")
  @HttpCode(202)
  public retry(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = retryFinalReadinessSchema.parse(body);
    if (input.run_id !== runId) throw new NotFoundException();
    return this.readiness.retry(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }
}
