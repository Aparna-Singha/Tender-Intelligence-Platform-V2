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
  pursuitDecisionSchema,
  riskFindingFilterSchema,
  riskReviewSchema,
  startRiskAnalysisSchema,
} from "@tender/contracts";
import type { Observable } from "rxjs";
import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { RisksService } from "./risks.service.js";

@ApiCookieAuth("session")
@ApiTags("early tender risk analysis")
@Controller("organisations/:organisationId/tenders/:tenderId")
export class RisksController {
  public constructor(private readonly risks: RisksService) {}

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_START")
  @Post("versions/:versionId/risk-analyses")
  @HttpCode(202)
  @ApiOperation({ summary: "Start cited EARLY tender-risk analysis" })
  public start(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startRiskAnalysisSchema.parse(body);
    return this.risks.start(
      organisationId,
      tenderId,
      versionId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_READ")
  @Get("versions/:versionId/risk-analyses")
  public list(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.risks.listRuns(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_READ")
  @Get("versions/:versionId/risk-analyses/current")
  public current(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.risks.current(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_READ")
  @Get("risk-analyses/:runId")
  public run(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.risks.getRun(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_READ")
  @Get("risk-analyses/:runId/findings")
  public findings(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.risks.findings(
      organisationId,
      tenderId,
      runId,
      riskFindingFilterSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_READ")
  @Get("risk-analyses/:runId/findings/:findingId")
  public finding(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("findingId") findingId: string,
  ): Promise<unknown> {
    return this.risks.finding(organisationId, tenderId, runId, findingId);
  }

  @RequireOrganisationPermission("TENDER_RISK_FINDING_REVIEW")
  @Post("risk-analyses/:runId/findings/:findingId/reviews")
  public review(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("findingId") findingId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.risks.review(
      organisationId,
      tenderId,
      runId,
      findingId,
      riskReviewSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_PURSUIT_DECISION_CREATE")
  @Post("risk-analyses/:runId/decisions")
  public decision(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.risks.decision(
      organisationId,
      tenderId,
      runId,
      pursuitDecisionSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_PURSUIT_DECISION_READ")
  @Get("risk-analyses/:runId/decisions")
  public decisions(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.risks.decisions(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_CANCEL")
  @Delete("risk-analyses/:runId")
  public cancel(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.risks.cancel(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_RETRY")
  @Post("risk-analyses/:runId/retry")
  @HttpCode(202)
  public retry(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startRiskAnalysisSchema.parse(body);
    return this.risks.retry(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("TENDER_RISK_ANALYSIS_READ")
  @Sse("risk-analyses/:runId/events")
  public events(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Observable<MessageEvent> {
    return this.risks.events(organisationId, tenderId, runId);
  }
}
