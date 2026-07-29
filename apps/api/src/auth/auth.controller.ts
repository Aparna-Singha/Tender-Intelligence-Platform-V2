/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { randomBytes } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type PasswordResetConfirm,
  type PasswordResetRequest,
  type RegisterRequest,
} from "@tender/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
  Authenticated,
  Public,
  RateLimited,
} from "../common/access-control.js";
import type { AuthenticatedRequest } from "../common/authenticated-request.js";
import { CookieService } from "../common/cookies.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  public constructor(
    private readonly auth: AuthService,
    private readonly cookies: CookieService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Get("csrf")
  @ApiOperation({ summary: "Issue a signed CSRF token" })
  public csrf(@Res({ passthrough: true }) reply: FastifyReply) {
    const token = randomBytes(32).toString("base64url");
    this.cookies.issueCsrf(reply, token);
    return { csrf_token: token };
  }

  @Public()
  @RateLimited({ limit: 5, scope: "register", windowSeconds: 60 })
  @Post("register")
  @ApiOperation({ summary: "Register a user and create a database session" })
  public async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) input: RegisterRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.register(input, this.context(request));
    this.cookies.setSession(reply, result.session.token);
    return { user: result.user };
  }

  @Public()
  @RateLimited({ limit: 10, scope: "login", windowSeconds: 60 })
  @HttpCode(HttpStatus.OK)
  @Post("login")
  @ApiOperation({ summary: "Authenticate with email and password" })
  public async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) input: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.auth.login(input, this.context(request));
    if (result === null) {
      throw new UnauthorizedException();
    }
    this.cookies.setSession(reply, result.session.token);
    return { user: result.user };
  }

  @Authenticated()
  @ApiCookieAuth("session")
  @HttpCode(HttpStatus.OK)
  @Post("logout")
  @ApiOperation({ summary: "Revoke the current session" })
  public async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ readonly success: true }> {
    await this.auth.logout(
      request.authenticatedUser.userId,
      request.authenticatedUser.sessionId,
      request.id,
    );
    this.cookies.clearSession(reply);
    return { success: true };
  }

  @Authenticated()
  @ApiCookieAuth("session")
  @Get("session")
  @ApiOperation({ summary: "Return the server-derived session context" })
  public session(@Req() request: AuthenticatedRequest) {
    return {
      active_organisation_id: request.authenticatedUser.activeOrganisationId,
      user: {
        display_name: request.authenticatedUser.displayName,
        email: request.authenticatedUser.email,
        id: request.authenticatedUser.userId,
      },
    };
  }

  @Authenticated()
  @ApiCookieAuth("session")
  @Get("sessions")
  @ApiOperation({ summary: "List the authenticated user's sessions" })
  public sessionsList(@Req() request: AuthenticatedRequest) {
    return this.sessions.list(
      request.authenticatedUser.userId,
      request.authenticatedUser.sessionId,
    );
  }

  @Authenticated()
  @ApiCookieAuth("session")
  @HttpCode(HttpStatus.OK)
  @Post("sessions/:sessionId/revoke")
  @ApiOperation({ summary: "Revoke one of the authenticated user's sessions" })
  public async revokeSession(
    @Param("sessionId") sessionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ readonly success: true }> {
    const revoked = await this.sessions.revoke(
      request.authenticatedUser.userId,
      sessionId,
      request.id,
    );
    if (!revoked) {
      throw new NotFoundException();
    }
    if (sessionId === request.authenticatedUser.sessionId) {
      this.cookies.clearSession(reply);
    }
    return { success: true };
  }

  @Public()
  @RateLimited({
    limit: 5,
    scope: "password-reset-request",
    windowSeconds: 300,
  })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post("password-reset/request")
  @ApiOperation({ summary: "Request generic password reset instructions" })
  public requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema))
    input: PasswordResetRequest,
  ) {
    return this.auth.requestPasswordReset(input.email);
  }

  @Public()
  @RateLimited({ limit: 5, scope: "password-reset", windowSeconds: 300 })
  @HttpCode(HttpStatus.OK)
  @Post("password-reset")
  @ApiOperation({ summary: "Reset a password with a one-time token" })
  public async resetPassword(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema))
    input: PasswordResetConfirm,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ readonly success: true }> {
    await this.auth.resetPassword(input, request.id);
    this.cookies.clearSession(reply);
    return { success: true };
  }

  private context(request: FastifyRequest) {
    return {
      ip: request.ip,
      requestId: request.id,
      userAgent: request.headers["user-agent"],
    };
  }
}
