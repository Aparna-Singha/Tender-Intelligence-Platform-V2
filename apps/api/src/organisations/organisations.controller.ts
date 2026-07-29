/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  changeMembershipRoleRequestSchema,
  createInvitationRequestSchema,
  createOrganisationRequestSchema,
  invitationAcceptSchema,
  type ChangeMembershipRoleRequest,
  type CreateInvitationRequest,
  type CreateOrganisationRequest,
  type InvitationAccept,
} from "@tender/contracts";

import {
  Authenticated,
  RequireOrganisationPermission,
} from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { SessionService } from "../auth/session.service.js";
import { OrganisationsService } from "./organisations.service.js";

@ApiCookieAuth("session")
@ApiTags("organisations")
@Controller()
export class OrganisationsController {
  public constructor(
    private readonly organisations: OrganisationsService,
    private readonly sessions: SessionService,
  ) {}

  @Authenticated()
  @Post("organisations")
  @ApiOperation({
    summary: "Create an organisation owned by the authenticated user",
  })
  public create(
    @Body(new ZodValidationPipe(createOrganisationRequestSchema))
    input: CreateOrganisationRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.organisations.create(
      input,
      request.authenticatedUser,
      request.id,
    );
  }

  @Authenticated()
  @Get("organisations")
  public list(@Req() request: AuthenticatedRequest) {
    return this.organisations.list(request.authenticatedUser.userId);
  }

  @RequireOrganisationPermission("ORGANISATION_READ")
  @Get("organisations/:organisationId")
  public get(@Param("organisationId") organisationId: string) {
    return this.organisations.get(organisationId);
  }

  @RequireOrganisationPermission("ORGANISATION_READ")
  @Post("organisations/:organisationId/select")
  public async select(
    @Param("organisationId") organisationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.sessions.selectOrganisation(
      request.authenticatedUser,
      organisationId,
    );
    return { active_organisation_id: organisationId };
  }

  @RequireOrganisationPermission("MEMBERSHIP_READ")
  @Get("organisations/:organisationId/members")
  public members(@Param("organisationId") organisationId: string) {
    return this.organisations.members(organisationId);
  }

  @RequireOrganisationPermission("MEMBERSHIP_INVITE")
  @Post("organisations/:organisationId/invitations")
  public invite(
    @Param("organisationId") organisationId: string,
    @Body(new ZodValidationPipe(createInvitationRequestSchema))
    input: CreateInvitationRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.organisations.invite(
      organisationId,
      input,
      request.organisationPrincipal!,
      request.id,
    );
  }

  @Authenticated()
  @Post("invitations/accept")
  public accept(
    @Body(new ZodValidationPipe(invitationAcceptSchema))
    input: InvitationAccept,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.organisations.accept(
      input.token,
      request.authenticatedUser,
      request.id,
    );
  }

  @RequireOrganisationPermission("MEMBERSHIP_ROLE_CHANGE")
  @Patch("organisations/:organisationId/members/:membershipId/role")
  public changeRole(
    @Param("organisationId") organisationId: string,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(changeMembershipRoleRequestSchema))
    input: ChangeMembershipRoleRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.organisations.changeRole(
      organisationId,
      membershipId,
      input,
      request.organisationPrincipal!,
      request.id,
    );
  }
}
