/* eslint-disable @typescript-eslint/explicit-function-return-type */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ChangeMembershipRoleRequest,
  CreateInvitationRequest,
  CreateOrganisationRequest,
} from "@tender/contracts";
import type { PrismaClient } from "@tender/database";
import {
  canChangeMemberRole,
  canInviteRole,
  type OrganisationPrincipal,
} from "@tender/domain";

import type { AuthenticatedUser } from "../common/authenticated-request.js";
import { createOpaqueToken, sha256 } from "../common/security-crypto.js";
import { PRISMA_CLIENT } from "../infrastructure.tokens.js";
import { NotificationService } from "../auth/notification.service.js";
import { SessionService } from "../auth/session.service.js";
import type { ApiEnvironment } from "@tender/config";
import { API_ENVIRONMENT } from "../infrastructure.tokens.js";

@Injectable()
export class OrganisationsService {
  public constructor(
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    private readonly notifications: NotificationService,
    private readonly sessions: SessionService,
  ) {}

  public async create(
    input: CreateOrganisationRequest,
    user: AuthenticatedUser,
    requestId: string,
  ) {
    const organisation = await this.database.$transaction(async (tx) => {
      const created = await tx.organisation.create({
        data: {
          createdByUserId: user.userId,
          name: input.name,
          type: input.type,
        },
      });
      await tx.organisationMembership.create({
        data: {
          organisationId: created.id,
          role: "OWNER",
          userId: user.userId,
        },
      });
      await tx.companyProfile.create({ data: { organisationId: created.id } });
      await tx.onboardingProgress.create({
        data: { organisationId: created.id, userId: user.userId },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: user.userId,
          eventType: "ORGANISATION_CREATED",
          organisationId: created.id,
          outcome: "SUCCESS",
          requestId,
          subjectId: created.id,
          subjectType: "organisation",
        },
      });
      return created;
    });
    await this.sessions.selectOrganisation(user, organisation.id);
    return organisation;
  }

  public list(userId: string) {
    return this.database.organisationMembership.findMany({
      orderBy: { organisation: { name: "asc" } },
      select: {
        organisation: { select: { id: true, name: true, type: true } },
        role: true,
      },
      where: { revokedAt: null, userId },
    });
  }

  public get(organisationId: string) {
    return this.database.organisation.findUniqueOrThrow({
      select: { createdAt: true, id: true, name: true, type: true },
      where: { id: organisationId },
    });
  }

  public members(organisationId: string) {
    return this.database.organisationMembership.findMany({
      select: {
        createdAt: true,
        id: true,
        role: true,
        user: { select: { displayName: true, email: true } },
      },
      where: { organisationId, revokedAt: null },
    });
  }

  public async invite(
    organisationId: string,
    input: CreateInvitationRequest,
    principal: OrganisationPrincipal,
    requestId: string,
  ) {
    if (!canInviteRole(principal.role, input.role))
      throw new ForbiddenException();
    if (!this.notifications.isConfigured)
      throw new BadRequestException("Invitation delivery is unavailable");
    const token = createOpaqueToken();
    const invitation = await this.database.invitation.create({
      data: {
        email: input.email,
        expiresAt: new Date(
          Date.now() + this.environment.INVITATION_TTL_SECONDS * 1_000,
        ),
        invitedByUserId: principal.userId,
        organisationId,
        role: input.role,
        tokenHash: sha256(token),
      },
      select: { id: true },
    });
    try {
      const url = new URL("/accept-invitation", this.environment.WEB_APP_URL);
      url.searchParams.set("token", token);
      await this.notifications.deliver({
        template: "invitation",
        to: input.email,
        variables: { invitation_url: url.toString() },
      });
      await this.database.auditEvent.create({
        data: {
          actorUserId: principal.userId,
          eventType: "INVITATION_CREATED",
          organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: invitation.id,
          subjectType: "invitation",
        },
      });
      return { id: invitation.id };
    } catch (error) {
      await this.database.invitation.delete({ where: { id: invitation.id } });
      throw error;
    }
  }

  public async accept(
    token: string,
    user: AuthenticatedUser,
    requestId: string,
  ) {
    const invitation = await this.database.invitation.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (
      invitation?.status !== "PENDING" ||
      invitation.expiresAt <= new Date() ||
      invitation.email !== user.email
    )
      throw new BadRequestException();
    return this.database.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        data: {
          acceptedAt: new Date(),
          acceptedByUserId: user.userId,
          status: "ACCEPTED",
        },
        where: { id: invitation.id, status: "PENDING" },
      });
      if (claimed.count !== 1) throw new BadRequestException();
      await tx.organisationMembership.upsert({
        create: {
          organisationId: invitation.organisationId,
          role: invitation.role,
          userId: user.userId,
        },
        update: { revokedAt: null, role: invitation.role },
        where: {
          organisationId_userId: {
            organisationId: invitation.organisationId,
            userId: user.userId,
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: user.userId,
          eventType: "INVITATION_ACCEPTED",
          organisationId: invitation.organisationId,
          outcome: "SUCCESS",
          requestId,
          subjectId: invitation.id,
          subjectType: "invitation",
        },
      });
      return { organisation_id: invitation.organisationId };
    });
  }

  public async changeRole(
    organisationId: string,
    membershipId: string,
    input: ChangeMembershipRoleRequest,
    principal: OrganisationPrincipal,
    requestId: string,
  ) {
    const target = await this.database.organisationMembership.findFirst({
      where: { id: membershipId, organisationId, revokedAt: null },
    });
    if (target === null) throw new NotFoundException();
    if (!canChangeMemberRole(principal, target.id, input.role))
      throw new ForbiddenException();
    const updated = await this.database.organisationMembership.update({
      data: { role: input.role },
      select: { id: true, role: true },
      where: { id: target.id },
    });
    await this.database.auditEvent.create({
      data: {
        actorUserId: principal.userId,
        eventType: "ROLE_CHANGED",
        metadata: { from: target.role, to: input.role },
        organisationId,
        outcome: "SUCCESS",
        requestId,
        subjectId: target.id,
        subjectType: "membership",
      },
    });
    return updated;
  }
}
