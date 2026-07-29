/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";
import type { PrismaClient } from "@tender/database";

import type { AuthenticatedUser } from "../common/authenticated-request.js";
import { createOpaqueToken, sha256 } from "../common/security-crypto.js";
import { API_ENVIRONMENT, PRISMA_CLIENT } from "../infrastructure.tokens.js";

export interface NewSession {
  readonly expiresAt: Date;
  readonly id: string;
  readonly token: string;
}

@Injectable()
export class SessionService {
  public constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
  ) {}

  public async create(
    userId: string,
    context: { readonly ipHash: string; readonly userAgentHash: string | null },
  ): Promise<NewSession> {
    const token = createOpaqueToken();
    const expiresAt = new Date(
      Date.now() + this.environment.SESSION_TTL_SECONDS * 1_000,
    );
    const session = await this.database.session.create({
      data: {
        expiresAt,
        ipHash: context.ipHash,
        tokenHash: sha256(token),
        userAgentHash: context.userAgentHash,
        userId,
      },
      select: { id: true },
    });

    return { expiresAt, id: session.id, token };
  }

  public async authenticate(token: string | null): Promise<AuthenticatedUser> {
    if (token === null) {
      throw new UnauthorizedException();
    }

    const session = await this.database.session.findUnique({
      include: { user: true },
      where: { tokenHash: sha256(token) },
    });
    if (session?.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new UnauthorizedException();
    }

    let activeOrganisationId = session.activeOrganisationId;
    if (activeOrganisationId !== null) {
      const membership = await this.database.organisationMembership.findFirst({
        select: { id: true },
        where: {
          organisationId: activeOrganisationId,
          revokedAt: null,
          userId: session.userId,
        },
      });
      if (membership === null) {
        activeOrganisationId = null;
      }
    }

    return {
      activeOrganisationId,
      displayName: session.user.displayName,
      email: session.user.email,
      platformRole: session.user.platformRole,
      sessionId: session.id,
      userId: session.userId,
    };
  }

  public async list(userId: string, currentSessionId: string) {
    const sessions = await this.database.session.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        expiresAt: true,
        id: true,
        lastSeenAt: true,
        revokedAt: true,
      },
      where: { userId },
    });
    return sessions.map((session) => ({
      ...session,
      current: session.id === currentSessionId,
    }));
  }

  public async revoke(
    userId: string,
    sessionId: string,
    requestId: string,
  ): Promise<boolean> {
    const result = await this.database.$transaction(async (transaction) => {
      const revoked = await transaction.session.updateMany({
        data: { activeOrganisationId: null, revokedAt: new Date() },
        where: { id: sessionId, revokedAt: null, userId },
      });
      if (revoked.count === 0) {
        return false;
      }
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "SESSION_REVOKED",
          outcome: "SUCCESS",
          requestId,
          subjectId: sessionId,
          subjectType: "session",
        },
      });
      return true;
    });
    return result;
  }

  public async selectOrganisation(
    user: AuthenticatedUser,
    organisationId: string,
  ): Promise<void> {
    const membership = await this.database.organisationMembership.findFirst({
      select: { id: true },
      where: {
        organisationId,
        revokedAt: null,
        userId: user.userId,
      },
    });
    if (membership === null) {
      throw new UnauthorizedException();
    }
    await this.database.session.updateMany({
      data: { activeOrganisationId: organisationId },
      where: {
        id: user.sessionId,
        revokedAt: null,
        userId: user.userId,
      },
    });
  }
}
