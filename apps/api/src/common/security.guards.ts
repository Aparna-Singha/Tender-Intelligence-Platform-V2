import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ApiEnvironment } from "@tender/config";
import type { PrismaClient } from "@tender/database";
import { hasPermission, isOrganisationRole } from "@tender/domain";
import type { FastifyRequest } from "fastify";

import { SessionService } from "../auth/session.service.js";
import { API_ENVIRONMENT, PRISMA_CLIENT } from "../infrastructure.tokens.js";
import {
  ACCESS_POLICY,
  RATE_LIMIT_POLICY,
  type AccessPolicy,
  type RateLimitPolicy,
} from "./access-control.js";
import type { AuthenticatedRequest } from "./authenticated-request.js";
import { CookieService } from "./cookies.js";
import { RateLimitService } from "./rate-limit.service.js";

@Injectable()
export class AccessGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly cookies: CookieService,
    private readonly sessions: SessionService,
    @Inject(PRISMA_CLIENT) private readonly database: PrismaClient,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(
      ACCESS_POLICY,
      targets,
    );
    if (policy?.kind === "public") return true;
    if (policy === undefined) throw new ForbiddenException();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.authenticatedUser = await this.sessions.authenticate(
      this.cookies.readSession(request),
    );
    if (policy.kind === "authenticated") return true;

    const organisationId = (request.params as { organisationId?: string })
      .organisationId;
    if (organisationId === undefined) throw new ForbiddenException();
    const membership = await this.database.organisationMembership.findFirst({
      select: { id: true, role: true },
      where: {
        organisationId,
        revokedAt: null,
        userId: request.authenticatedUser.userId,
      },
    });
    if (
      membership === null ||
      !isOrganisationRole(membership.role) ||
      !hasPermission(membership.role, policy.permission)
    ) {
      throw new ForbiddenException();
    }
    request.organisationPrincipal = {
      membershipId: membership.id,
      organisationId,
      role: membership.role,
      userId: request.authenticatedUser.userId,
    };
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  public constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    private readonly cookies: CookieService,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    if (request.headers.origin !== this.environment.WEB_ORIGIN)
      throw new ForbiddenException();
    const token = request.headers["x-csrf-token"];
    if (typeof token !== "string" || !this.cookies.verifyCsrf(request, token))
      throw new ForbiddenException();
    return true;
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly limits: RateLimitService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<
      RateLimitPolicy | undefined
    >(RATE_LIMIT_POLICY, [context.getHandler(), context.getClass()]);
    if (policy === undefined) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const allowed = await this.limits.consume(
      `${policy.scope}:${request.ip}`,
      policy.limit,
      policy.windowSeconds,
    );
    if (!allowed)
      throw new HttpException(
        "Too many requests",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}
