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
  assessmentFilterSchema,
  assessmentReviewSchema,
  createCompanyCitationSchema,
  createEvidenceFactSchema,
  createEvidenceFactVersionSchema,
  evidenceFactReviewSchema,
  linkAssessmentEvidenceSchema,
  startEligibilityAssessmentSchema,
} from "@tender/contracts";
import { hasPermission } from "@tender/domain";
import type { Observable } from "rxjs";
import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { EligibilityService } from "./eligibility.service.js";

@ApiCookieAuth("session")
@ApiTags("controlled eligibility assessments")
@Controller("organisations/:organisationId")
export class EligibilityController {
  public constructor(private readonly eligibility: EligibilityService) {}

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_START")
  @Post("tenders/:tenderId/versions/:versionId/eligibility-assessments")
  @HttpCode(202)
  @ApiOperation({
    summary:
      "Start evidence comparison after a current human CONTINUE decision",
  })
  public start(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startEligibilityAssessmentSchema.parse(body);
    return this.eligibility.start(
      organisationId,
      tenderId,
      versionId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_READ")
  @Get("tenders/:tenderId/versions/:versionId/eligibility-assessments")
  public listRuns(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.eligibility.listRuns(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_READ")
  @Get("tenders/:tenderId/versions/:versionId/eligibility-assessments/current")
  public current(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("versionId") versionId: string,
  ): Promise<unknown> {
    return this.eligibility.current(organisationId, tenderId, versionId);
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_READ")
  @Get("tenders/:tenderId/eligibility-assessments/:runId")
  public run(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Promise<unknown> {
    return this.eligibility.getRun(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_READ")
  @Get("tenders/:tenderId/eligibility-assessments/:runId/matrix")
  public matrix(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.eligibility.matrix(
      organisationId,
      tenderId,
      runId,
      assessmentFilterSchema.parse(query),
    );
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_REVIEW")
  @Post(
    "tenders/:tenderId/eligibility-assessments/:runId/items/:assessmentId/reviews",
  )
  public reviewAssessment(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.reviewAssessment(
      organisationId,
      tenderId,
      runId,
      assessmentId,
      assessmentReviewSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
      request.organisationPrincipal === undefined
        ? false
        : hasPermission(
            request.organisationPrincipal.role,
            "ELIGIBILITY_ASSESSMENT_FINALISE",
          ),
    );
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_LINK")
  @Post(
    "tenders/:tenderId/eligibility-assessments/:runId/items/:assessmentId/evidence-links",
  )
  public linkEvidence(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("assessmentId") assessmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.linkEvidence(
      organisationId,
      tenderId,
      runId,
      assessmentId,
      linkAssessmentEvidenceSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_LINK")
  @Delete(
    "tenders/:tenderId/eligibility-assessments/:runId/items/:assessmentId/evidence-links/:linkId",
  )
  public unlinkEvidence(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Param("assessmentId") assessmentId: string,
    @Param("linkId") linkId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.unlinkEvidence(
      organisationId,
      tenderId,
      runId,
      assessmentId,
      linkId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_CANCEL")
  @Delete("tenders/:tenderId/eligibility-assessments/:runId")
  public cancel(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.cancel(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_RETRY")
  @Post("tenders/:tenderId/eligibility-assessments/:runId/retry")
  @HttpCode(202)
  public retry(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    const input = startEligibilityAssessmentSchema.parse(body);
    return this.eligibility.retry(
      organisationId,
      tenderId,
      runId,
      request.authenticatedUser.userId,
      input.idempotency_key,
      request.id,
    );
  }

  @RequireOrganisationPermission("ELIGIBILITY_ASSESSMENT_READ")
  @Sse("tenders/:tenderId/eligibility-assessments/:runId/events")
  public events(
    @Param("organisationId") organisationId: string,
    @Param("tenderId") tenderId: string,
    @Param("runId") runId: string,
  ): Observable<MessageEvent> {
    return this.eligibility.events(organisationId, tenderId, runId);
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_FACT_CREATE")
  @Post("company-evidence-facts")
  public createFact(
    @Param("organisationId") organisationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.createFact(
      organisationId,
      createEvidenceFactSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_FACT_READ")
  @Get("company-evidence-facts")
  public facts(
    @Param("organisationId") organisationId: string,
  ): Promise<unknown> {
    return this.eligibility.facts(organisationId);
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_FACT_CREATE")
  @Post("company-evidence-facts/:factId/citations")
  public citeFact(
    @Param("organisationId") organisationId: string,
    @Param("factId") factId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.citeFact(
      organisationId,
      factId,
      createCompanyCitationSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_FACT_CREATE")
  @Post("company-evidence-facts/:factId/versions")
  public correctFact(
    @Param("organisationId") organisationId: string,
    @Param("factId") factId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.correctFact(
      organisationId,
      factId,
      createEvidenceFactVersionSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }

  @RequireOrganisationPermission("COMPANY_EVIDENCE_FACT_REVIEW")
  @Post("company-evidence-facts/:factId/reviews")
  public reviewFact(
    @Param("organisationId") organisationId: string,
    @Param("factId") factId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<unknown> {
    return this.eligibility.reviewFact(
      organisationId,
      factId,
      evidenceFactReviewSchema.parse(body),
      request.authenticatedUser.userId,
      request.id,
    );
  }
}
