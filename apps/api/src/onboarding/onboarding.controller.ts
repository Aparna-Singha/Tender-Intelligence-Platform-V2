import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Req,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { OnboardingStep } from "@tender/contracts";

import { RequireOrganisationPermission } from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import {
  OnboardingService,
  type CompanyProfileResponse,
  type OnboardingResponse,
} from "./onboarding.service.js";

@ApiCookieAuth("session")
@ApiTags("onboarding")
@Controller("organisations/:organisationId")
export class OnboardingController {
  public constructor(private readonly onboarding: OnboardingService) {}

  @RequireOrganisationPermission("ONBOARDING_READ")
  @Get("onboarding")
  @ApiOperation({ summary: "Resume the authenticated member's onboarding" })
  public resume(
    @Param("organisationId") organisationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<OnboardingResponse> {
    return this.onboarding.resume(
      organisationId,
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("ONBOARDING_UPDATE")
  @Put("onboarding/steps/:step")
  @ApiOperation({ summary: "Validate and autosave one onboarding step" })
  @ApiBody({
    description:
      "Step-specific data selected by the step parameter and validated against the shared Zod contract.",
    schema: { additionalProperties: false, type: "object" },
  })
  @ApiParam({
    name: "step",
    schema: { maximum: 8, minimum: 1, type: "integer" },
  })
  public save(
    @Param("organisationId") organisationId: string,
    @Param("step", ParseIntPipe) step: OnboardingStep,
    @Body() payload: unknown,
    @Req() request: AuthenticatedRequest,
  ): Promise<OnboardingResponse> {
    if (step < 1 || step > 8) throw new BadRequestException();
    return this.onboarding.saveStep(
      organisationId,
      request.authenticatedUser.userId,
      step,
      payload,
      request.id,
    );
  }

  @RequireOrganisationPermission("COMPANY_PROFILE_READ")
  @Get("company-profile")
  @ApiOperation({ summary: "Read the structured organisation company profile" })
  public profile(
    @Param("organisationId") organisationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CompanyProfileResponse> {
    return this.onboarding.profile(
      organisationId,
      request.authenticatedUser.userId,
    );
  }

  @RequireOrganisationPermission("ONBOARDING_READ")
  @Get("dashboard-recommendations")
  @ApiOperation({
    summary: "Return role-aware onboarding dashboard cards and display mode",
  })
  public recommendations(
    @Param("organisationId") organisationId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<OnboardingResponse> {
    return this.onboarding.resume(
      organisationId,
      request.authenticatedUser.userId,
    );
  }
}
