import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { ApiEnvironment } from "@tender/config";
import type {
  LoginRequest,
  PasswordResetConfirm,
  RegisterRequest,
} from "@tender/contracts";
import type { PrismaClient } from "@tender/database";

import {
  createOpaqueToken,
  privacyHash,
  ScryptPasswordHasher,
  sha256,
} from "../common/security-crypto.js";
import { API_ENVIRONMENT, PRISMA_CLIENT } from "../infrastructure.tokens.js";
import { NotificationService } from "./notification.service.js";
import { SessionService, type NewSession } from "./session.service.js";

export interface AuthenticationContext {
  readonly ip: string;
  readonly requestId: string;
  readonly userAgent: string | undefined;
}

export interface AuthenticationResult {
  readonly session: NewSession;
  readonly user: {
    readonly display_name: string;
    readonly email: string;
    readonly id: string;
  };
}

const genericResetResponse = {
  message: "If the account exists, reset instructions will be sent.",
} as const;

@Injectable()
export class AuthService {
  private readonly passwordHasher = new ScryptPasswordHasher();
  private readonly dummyHash = this.passwordHasher.hash(
    "Dummy-password-which-is-never-an-account-9374",
  );

  public constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
    private readonly notifications: NotificationService,
    private readonly sessions: SessionService,
  ) {}

  public async register(
    input: RegisterRequest,
    context: AuthenticationContext,
  ): Promise<AuthenticationResult> {
    const passwordHash = await this.passwordHasher.hash(input.password);
    let user;
    try {
      user = await this.database.user.create({
        data: {
          displayName: input.display_name,
          email: input.email,
          passwordHash,
        },
        select: { displayName: true, email: true, id: true },
      });
    } catch {
      throw new ConflictException();
    }
    const session = await this.sessions.create(
      user.id,
      this.sessionContext(context),
    );
    await this.database.auditEvent.create({
      data: {
        actorUserId: user.id,
        eventType: "LOGIN_SUCCEEDED",
        ipHash: this.hashPrivate(context.ip),
        outcome: "SUCCESS",
        requestId: context.requestId,
        subjectId: session.id,
        subjectType: "session",
      },
    });
    return {
      session,
      user: { display_name: user.displayName, email: user.email, id: user.id },
    };
  }

  public async login(
    input: LoginRequest,
    context: AuthenticationContext,
  ): Promise<AuthenticationResult | null> {
    const user = await this.database.user.findUnique({
      where: { email: input.email },
    });
    const passwordMatches = await this.passwordHasher.verify(
      input.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (user === null || !passwordMatches) {
      await this.database.auditEvent.create({
        data: {
          eventType: "LOGIN_FAILED",
          ipHash: this.hashPrivate(context.ip),
          metadata: { email_hash: this.hashPrivate(input.email) },
          outcome: "DENIED",
          requestId: context.requestId,
          subjectType: "user",
        },
      });
      return null;
    }

    const session = await this.sessions.create(
      user.id,
      this.sessionContext(context),
    );
    await this.database.auditEvent.create({
      data: {
        actorUserId: user.id,
        eventType: "LOGIN_SUCCEEDED",
        ipHash: this.hashPrivate(context.ip),
        outcome: "SUCCESS",
        requestId: context.requestId,
        subjectId: session.id,
        subjectType: "session",
      },
    });
    return {
      session,
      user: {
        display_name: user.displayName,
        email: user.email,
        id: user.id,
      },
    };
  }

  public async logout(
    userId: string,
    sessionId: string,
    requestId: string,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.session.updateMany({
        data: { activeOrganisationId: null, revokedAt: new Date() },
        where: { id: sessionId, revokedAt: null, userId },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: userId,
          eventType: "LOGOUT",
          outcome: "SUCCESS",
          requestId,
          subjectId: sessionId,
          subjectType: "session",
        },
      });
    });
  }

  public async requestPasswordReset(
    email: string,
  ): Promise<typeof genericResetResponse> {
    const user = await this.database.user.findUnique({
      select: { email: true, id: true },
      where: { email },
    });
    if (user === null || !this.notifications.isConfigured) {
      return genericResetResponse;
    }

    const token = createOpaqueToken();
    const resetToken = await this.database.passwordResetToken.create({
      data: {
        expiresAt: new Date(
          Date.now() + this.environment.PASSWORD_RESET_TTL_SECONDS * 1_000,
        ),
        tokenHash: sha256(token),
        userId: user.id,
      },
      select: { id: true },
    });
    try {
      const resetUrl = new URL("/reset-password", this.environment.WEB_APP_URL);
      resetUrl.searchParams.set("token", token);
      await this.notifications.deliver({
        template: "password_reset",
        to: user.email,
        variables: { reset_url: resetUrl.toString() },
      });
    } catch {
      await this.database.passwordResetToken.delete({
        where: { id: resetToken.id },
      });
    }
    return genericResetResponse;
  }

  public async resetPassword(
    input: PasswordResetConfirm,
    requestId: string,
  ): Promise<void> {
    const resetToken = await this.database.passwordResetToken.findUnique({
      where: { tokenHash: sha256(input.token) },
    });
    if (resetToken?.consumedAt !== null || resetToken.expiresAt <= new Date()) {
      throw new BadRequestException();
    }
    const passwordHash = await this.passwordHasher.hash(input.password);
    await this.database.$transaction(async (transaction) => {
      const consumed = await transaction.passwordResetToken.updateMany({
        data: { consumedAt: new Date() },
        where: {
          consumedAt: null,
          expiresAt: { gt: new Date() },
          id: resetToken.id,
        },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException();
      }
      await transaction.user.update({
        data: { passwordHash },
        where: { id: resetToken.userId },
      });
      await transaction.session.updateMany({
        data: { activeOrganisationId: null, revokedAt: new Date() },
        where: { revokedAt: null, userId: resetToken.userId },
      });
      await transaction.auditEvent.create({
        data: {
          actorUserId: resetToken.userId,
          eventType: "PASSWORD_RESET_COMPLETED",
          outcome: "SUCCESS",
          requestId,
          subjectId: resetToken.userId,
          subjectType: "user",
        },
      });
    });
  }

  private hashPrivate(value: string): string {
    return privacyHash(value, this.environment.COOKIE_SECRET);
  }

  private sessionContext(context: AuthenticationContext): {
    readonly ipHash: string;
    readonly userAgentHash: string | null;
  } {
    return {
      ipHash: this.hashPrivate(context.ip),
      userAgentHash:
        context.userAgent === undefined
          ? null
          : this.hashPrivate(context.userAgent),
    };
  }
}
