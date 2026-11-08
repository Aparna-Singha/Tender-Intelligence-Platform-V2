const { sign } = vi.hoisted(() => ({
  sign: vi.fn().mockResolvedValue("https://private.example/temporary"),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: sign }));

import { Module, UnauthorizedException } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { apiEnvironmentSchema } from "@tender/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SessionService } from "../src/auth/session.service.js";
import { CookieService } from "../src/common/cookies.js";
import { AccessGuard, CsrfGuard } from "../src/common/security.guards.js";
import { DocumentsService } from "../src/documents/documents.service.js";
import { RequirementEvidenceController } from "../src/eligibility/requirement-evidence.controller.js";
import { RequirementEvidenceService } from "../src/eligibility/requirement-evidence.service.js";
import {
  API_ENVIRONMENT,
  JOB_QUEUE,
  PRISMA_CLIENT,
  S3_CLIENT,
} from "../src/infrastructure.tokens.js";

const ids = {
  org: "11111111-1111-4111-8111-111111111111",
  otherOrg: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tender: "22222222-2222-4222-8222-222222222222",
  otherTender: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  version: "33333333-3333-4333-8333-333333333333",
  requirement: "44444444-4444-4444-8444-444444444444",
  attachment: "55555555-5555-4555-8555-555555555555",
};
const webOrigin = "http://127.0.0.1:3100";
const environment = {
  COOKIE_SECRET: "test-only-cookie-secret-123456789",
  SESSION_COOKIE_SECURE: false,
  SESSION_TTL_SECONDS: 3600,
  WEB_ORIGIN: webOrigin,
  DOCUMENT_DOWNLOAD_TTL_SECONDS: 60,
  S3_BUCKET: "private-test",
} as never;
const database = {
  organisationMembership: {
    findFirst: vi
      .fn()
      .mockImplementation((query: { where: { organisationId: string } }) =>
        Promise.resolve(
          query.where.organisationId === ids.org
            ? { id: "membership", role: "OWNER" }
            : null,
        ),
      ),
  },
  structuredRequirement: {
    findFirst: vi
      .fn()
      .mockImplementation(
        (query: { where: { extractionRun: { tenderId: string } } }) =>
          Promise.resolve(
            query.where.extractionRun.tenderId === ids.tender
              ? { extractionRunId: "run-a" }
              : null,
          ),
      ),
  },
  tenderVersion: {
    findFirst: vi.fn().mockResolvedValue({
      activeExtractionRunId: "run-a",
      tender: { currentVersionId: "different-version", deletedAt: null },
    }),
  },
  requirementEvidenceAttachment: {
    findFirst: vi.fn().mockResolvedValue({
      documentId: "document-a",
      detachedAt: new Date(),
      documentVersion: {
        id: "historical-v1",
        approvedObjectKey: "approved/historical-v1",
        versionNumber: 1,
        extension: ".pdf",
      },
    }),
  },
  documentAccessEvent: { create: vi.fn().mockResolvedValue(undefined) },
  auditEvent: { create: vi.fn().mockResolvedValue(undefined) },
};
const session = {
  authenticate: vi
    .fn()
    .mockImplementation((token: string | null) =>
      token === "valid-session"
        ? Promise.resolve({ userId: "reviewer" })
        : Promise.reject(new UnauthorizedException()),
    ),
};

@Module({
  controllers: [RequirementEvidenceController],
  providers: [
    { provide: API_ENVIRONMENT, useValue: environment },
    { provide: PRISMA_CLIENT, useValue: database },
    { provide: S3_CLIENT, useValue: {} },
    { provide: JOB_QUEUE, useValue: {} },
    { provide: SessionService, useValue: session },
    { provide: CookieService, useValue: new CookieService(environment) },
    DocumentsService,
    RequirementEvidenceService,
    CsrfGuard,
    AccessGuard,
    { provide: APP_GUARD, useExisting: CsrfGuard },
    { provide: APP_GUARD, useExisting: AccessGuard },
  ],
})
class DownloadTestModule {}

describe("requirement download HTTP guards", () => {
  it("bounds signed download lifetimes to 30 through 300 seconds", () => {
    const valid = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:local@127.0.0.1:5432/local",
      REDIS_URL: "redis://127.0.0.1:6379",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: "local",
      S3_ACCESS_KEY_ID: "local",
      S3_SECRET_ACCESS_KEY: "local",
      COOKIE_SECRET: "local-cookie-secret-at-least-32-characters",
      WEB_APP_URL: webOrigin,
      WEB_ORIGIN: webOrigin,
    };
    const accepted = (ttl: number): boolean =>
      apiEnvironmentSchema.safeParse({
        ...valid,
        DOCUMENT_DOWNLOAD_TTL_SECONDS: ttl,
      }).success;
    expect(accepted(29)).toBe(false);
    expect(accepted(30)).toBe(true);
    expect(accepted(300)).toBe(true);
    expect(accepted(301)).toBe(false);
  });
  let app: NestFastifyApplication;
  let csrfCookie: string;
  beforeAll(async () => {
    const cookies = new CookieService(environment);
    const reply = { header: vi.fn() };
    cookies.issueCsrf(reply as never, "valid-csrf");
    csrfCookie = (reply.header.mock.calls[0]?.[1] as string).split(";")[0]!;
    app = await NestFactory.create<NestFastifyApplication>(
      DownloadTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });

  const url = (org: string, tender: string): string =>
    `/organisations/${org}/tenders/${tender}/versions/${ids.version}/requirements/${ids.requirement}/attachments/${ids.attachment}/download`;
  const headers = (): Record<string, string> => ({
    cookie: `tip_session=valid-session; ${csrfCookie}`,
    origin: webOrigin,
    "x-csrf-token": "valid-csrf",
  });

  it("denies missing session and missing or invalid CSRF", async () => {
    const target = url(ids.org, ids.tender);
    const missingCsrf = headers();
    delete missingCsrf["x-csrf-token"];
    expect(
      (
        await app.inject({
          method: "POST",
          url: target,
          headers: { ...headers(), cookie: csrfCookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: target,
          headers: missingCsrf,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: target,
          headers: { ...headers(), "x-csrf-token": "tampered" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("denies cross-organisation and cross-tender requests", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: url(ids.otherOrg, ids.tender),
          headers: headers(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: url(ids.org, ids.otherTender),
          headers: headers(),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("returns a bounded signed URL for the detached historical attached version", async () => {
    const response = await app.inject({
      method: "POST",
      url: url(ids.org, ids.tender),
      headers: headers(),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      download_url: "https://private.example/temporary",
      document_version_id: "historical-v1",
      expires_in_seconds: 60,
    });
    expect(
      database.requirementEvidenceAttachment.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ids.attachment,
          organisationId: ids.org,
          tenderId: ids.tender,
        }),
      }),
    );
    expect(sign).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: 60 },
    );
  });
});
