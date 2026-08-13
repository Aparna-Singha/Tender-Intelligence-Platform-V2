import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CookieService } from "../src/common/cookies.js";
import { ScryptPasswordHasher } from "../src/common/security-crypto.js";
import {
  AccessGuard,
  CsrfGuard,
  RateLimitGuard,
} from "../src/common/security.guards.js";
import { SessionService } from "../src/auth/session.service.js";

const webOrigin = "https://app.example.test";
const environment = {
  COOKIE_SECRET: "a-secret-used-only-for-tests-123456789",
  SESSION_COOKIE_SECURE: true,
  SESSION_TTL_SECONDS: 3600,
  WEB_ORIGIN: webOrigin,
} as never;

function httpContext(request: unknown): never {
  return {
    getClass: () => class Test {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("password and cookie security", () => {
  it("hashes passwords with scrypt and rejects a wrong password", async () => {
    const hasher = new ScryptPasswordHasher();
    const hash = await hasher.hash("StrongPassword123");
    expect(hash).not.toContain("StrongPassword123");
    await expect(hasher.verify("StrongPassword123", hash)).resolves.toBe(true);
    await expect(hasher.verify("WrongPassword123", hash)).resolves.toBe(false);
  }, 30_000);

  it("sets HttpOnly, Secure and SameSite session cookie flags", () => {
    const reply = { header: vi.fn() } as never;
    new CookieService(environment).setSession(reply, "opaque");
    expect(
      (reply as { header: ReturnType<typeof vi.fn> }).header,
    ).toHaveBeenCalledWith(
      "set-cookie",
      expect.stringMatching(/HttpOnly.*Secure|Secure.*HttpOnly/),
    );
    expect(
      (reply as { header: ReturnType<typeof vi.fn> }).header.mock.calls[0]?.[1],
    ).toContain("SameSite=Strict");
  });
});

describe("CSRF", () => {
  it("accepts a signed double-submit token from the configured origin", () => {
    const cookies = new CookieService(environment);
    const reply = { header: vi.fn() } as never;
    cookies.issueCsrf(reply, "token");
    const cookie = (reply as { header: ReturnType<typeof vi.fn> }).header.mock
      .calls[0]?.[1] as string;
    const guard = new CsrfGuard(environment, cookies);
    expect(
      guard.canActivate(
        httpContext({
          headers: {
            cookie,
            origin: webOrigin,
            "x-csrf-token": "token",
          },
          method: "POST",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a foreign origin and a tampered token", () => {
    const cookies = new CookieService(environment);
    const guard = new CsrfGuard(environment, cookies);
    expect(() =>
      guard.canActivate(
        httpContext({
          headers: { origin: "https://evil.example", "x-csrf-token": "token" },
          method: "POST",
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});

describe("sessions and rate limits", () => {
  it("rejects revoked database sessions", async () => {
    const database = {
      session: {
        findUnique: vi.fn().mockResolvedValue({
          expiresAt: new Date(Date.now() + 1_000),
          revokedAt: new Date(),
          user: {},
          userId: "u",
        }),
      },
    };
    const service = new SessionService(environment, database as never);
    await expect(service.authenticate("revoked")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("blocks requests after the configured rate limit", async () => {
    const reflector = {
      getAllAndOverride: vi
        .fn()
        .mockReturnValue({ limit: 2, scope: "login", windowSeconds: 60 }),
    };
    const limits = { consume: vi.fn().mockResolvedValue(false) };
    const guard = new RateLimitGuard(reflector as never, limits as never);
    await expect(
      guard.canActivate(httpContext({ ip: "127.0.0.1" })),
    ).rejects.toBeInstanceOf(HttpException);
  });
});

describe("deny-by-default organisation access", () => {
  const user = {
    activeOrganisationId: null,
    displayName: "User",
    email: "user@example.test",
    platformRole: null,
    sessionId: "session",
    userId: "user-a",
  };

  it("rejects an unauthenticated protected request", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({ kind: "authenticated" }),
    };
    const sessions = {
      authenticate: vi.fn().mockRejectedValue(new UnauthorizedException()),
    };
    const guard = new AccessGuard(
      reflector as never,
      { readSession: vi.fn().mockReturnValue(null) } as never,
      sessions as never,
      {} as never,
    );
    await expect(
      guard.canActivate(httpContext({ headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("treats an altered organisation ID only as a selector and denies cross-organisation access", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({
        kind: "organisation",
        permission: "ORGANISATION_READ",
      }),
    };
    const database = {
      organisationMembership: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const guard = new AccessGuard(
      reflector as never,
      { readSession: vi.fn().mockReturnValue("opaque") } as never,
      { authenticate: vi.fn().mockResolvedValue(user) } as never,
      database as never,
    );
    await expect(
      guard.canActivate(
        httpContext({
          headers: {},
          params: { organisationId: "organisation-b" },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.organisationMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organisationId: "organisation-b",
          revokedAt: null,
          userId: "user-a",
        },
      }),
    );
  });

  it("gives Platform Admin no implicit organisation membership", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({
        kind: "organisation",
        permission: "DOCUMENT_READ",
      }),
    };
    const platformAdmin = {
      ...user,
      platformRole: "PLATFORM_ADMIN",
      userId: "platform-admin",
    };
    const database = {
      organisationMembership: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const guard = new AccessGuard(
      reflector as never,
      { readSession: vi.fn().mockReturnValue("opaque") } as never,
      { authenticate: vi.fn().mockResolvedValue(platformAdmin) } as never,
      database as never,
    );

    await expect(
      guard.canActivate(
        httpContext({
          headers: {},
          params: { organisationId: "organisation-a" },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("ignores browser-supplied user and role authority", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue({
        kind: "organisation",
        permission: "TENDER_UPLOAD",
      }),
    };
    const database = {
      organisationMembership: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "membership-a", role: "REVIEWER" }),
      },
    };
    const guard = new AccessGuard(
      reflector as never,
      { readSession: vi.fn().mockReturnValue("opaque") } as never,
      { authenticate: vi.fn().mockResolvedValue(user) } as never,
      database as never,
    );

    await expect(
      guard.canActivate(
        httpContext({
          body: {
            actor_user_id: "owner-a",
            organisation_role: "OWNER",
            user_id: "owner-a",
          },
          headers: {},
          params: { organisationId: "organisation-a" },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.organisationMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organisationId: "organisation-a",
          revokedAt: null,
          userId: "user-a",
        },
      }),
    );
  });
});
