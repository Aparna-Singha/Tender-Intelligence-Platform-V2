import { describe, expect, it } from "vitest";

import {
  apiEnvironmentSchema,
  EnvironmentValidationError,
  parseEnvironment,
  workerEnvironmentSchema,
} from "../src/index.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://user:password@localhost:5432/database",
  REDIS_URL: "redis://localhost:6379",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "local-bucket",
  S3_ACCESS_KEY_ID: "local-user",
  S3_SECRET_ACCESS_KEY: "local-password",
  COOKIE_SECRET: "local-cookie-secret-that-is-at-least-32-characters",
  WEB_APP_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:3000",
} satisfies NodeJS.ProcessEnv;

describe("parseEnvironment", () => {
  it("applies safe service defaults", () => {
    const result = parseEnvironment(
      "api",
      apiEnvironmentSchema,
      validEnvironment,
    );

    expect(result.API_PORT).toBe(4000);
    expect(result.API_METRICS_HOST).toBe("127.0.0.1");
    expect(result.API_METRICS_PORT).toBe(4100);
    expect(result.REQUEST_ID_HEADER).toBe("x-request-id");
    expect(result.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("rejects missing required settings without exposing supplied values", () => {
    const suppliedSecret = "must-not-appear-in-errors";

    expect(() =>
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        DATABASE_URL: undefined,
        S3_SECRET_ACCESS_KEY: suppliedSecret,
      }),
    ).toThrow(EnvironmentValidationError);

    try {
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        DATABASE_URL: undefined,
        S3_SECRET_ACCESS_KEY: suppliedSecret,
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain(suppliedSecret);
    }
  });

  it("rejects non-PostgreSQL database URLs", () => {
    expect(() =>
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        DATABASE_URL: "mysql://localhost/database",
      }),
    ).toThrow("DATABASE_URL must use PostgreSQL");
  });

  it("requires complete email delivery configuration", () => {
    expect(() =>
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        EMAIL_DELIVERY_URL: "https://email.example.test/deliver",
      }),
    ).toThrow("must be configured together");
  });

  it("requires secure delivery configuration in production", () => {
    expect(() =>
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        NODE_ENV: "production",
      }),
    ).toThrow("required in production");
  });

  it("rejects production placeholder secrets without echoing their values", () => {
    expect(() =>
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        NODE_ENV: "production",
        COOKIE_SECRET: "replace-with-production-cookie-secret-value",
        EMAIL_DELIVERY_TOKEN: "replace-with-email-token",
        EMAIL_DELIVERY_URL: "https://email.example.test/deliver",
        EMAIL_FROM: "no-reply@example.test",
        GEMINI_API_KEY: "replace-with-provider-key",
        REDIS_URL: "redis://production-cache.example.test:6379",
        S3_ACCESS_KEY_ID: "replace-with-access-key",
        S3_ENDPOINT: "https://objects.example.test",
        S3_SECRET_ACCESS_KEY: "replace-with-secret-key",
        SESSION_COOKIE_SECURE: "true",
        TRUST_PROXY: "true",
        WEB_APP_URL: "https://app.example.test",
        WEB_ORIGIN: "https://app.example.test",
      }),
    ).toThrow("must be supplied from production secrets");

    try {
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        NODE_ENV: "production",
        COOKIE_SECRET: "replace-with-production-cookie-secret-value",
        EMAIL_DELIVERY_TOKEN: "replace-with-email-token",
        EMAIL_DELIVERY_URL: "https://email.example.test/deliver",
        EMAIL_FROM: "no-reply@example.test",
        REDIS_URL: "redis://production-cache.example.test:6379",
        S3_ACCESS_KEY_ID: "replace-with-access-key",
        S3_ENDPOINT: "https://objects.example.test",
        S3_SECRET_ACCESS_KEY: "replace-with-secret-key",
        SESSION_COOKIE_SECURE: "true",
        TRUST_PROXY: "true",
        WEB_APP_URL: "https://app.example.test",
        WEB_ORIGIN: "https://app.example.test",
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain(
        "replace-with-production-cookie-secret-value",
      );
    }
  });

  it("rejects local HTTP browser boundaries and insecure cookies in production", () => {
    expect(() =>
      parseEnvironment("api", apiEnvironmentSchema, {
        ...validEnvironment,
        NODE_ENV: "production",
        EMAIL_DELIVERY_TOKEN: "production-email-token-123456",
        EMAIL_DELIVERY_URL: "https://email.vendor.test/deliver",
        EMAIL_FROM: "no-reply@example.test",
        GEMINI_API_KEY: "production-gemini-key-123456",
        REDIS_URL: "redis://production-cache.internal:6379",
        S3_ACCESS_KEY_ID: "production-access-key",
        S3_ENDPOINT: "https://objects.storage.internal",
        S3_SECRET_ACCESS_KEY: "production-secret-key",
        SESSION_COOKIE_SECURE: "false",
        TRUST_PROXY: "false",
        WEB_APP_URL: "http://localhost:3000",
        WEB_ORIGIN: "http://localhost:3000",
      }),
    ).toThrow("production HTTPS endpoint");
  });

  it("allows production startup with provider egress explicitly disabled", () => {
    const result = parseEnvironment("api", apiEnvironmentSchema, {
      ...validEnvironment,
      NODE_ENV: "production",
      DRAFT_PROVIDER: "disabled",
      EMAIL_DELIVERY_TOKEN: "production-email-token-123456",
      EMAIL_DELIVERY_URL: "https://email.vendor.test/deliver",
      EMAIL_FROM: "no-reply@example.test",
      RAG_PROVIDER: "disabled",
      REDIS_URL: "redis://production-cache.internal:6379",
      S3_ACCESS_KEY_ID: "production-access-key",
      S3_ENDPOINT: "https://objects.storage.internal",
      S3_SECRET_ACCESS_KEY: "production-secret-key",
      SESSION_COOKIE_SECURE: "true",
      TRUST_PROXY: "true",
      WEB_APP_URL: "https://app.production.test",
      WEB_ORIGIN: "https://app.production.test",
    });

    expect(result.RAG_PROVIDER).toBe("disabled");
    expect(result.DRAFT_PROVIDER).toBe("disabled");
  });

  it("requires an explicit worker provider key when production egress is enabled", () => {
    expect(() =>
      parseEnvironment("worker", workerEnvironmentSchema, {
        ...validEnvironment,
        CLAMAV_HOST: "clamav.internal",
        NODE_ENV: "production",
        REDIS_URL: "redis://production-cache.internal:6379",
        S3_ACCESS_KEY_ID: "production-access-key",
        S3_ENDPOINT: "https://objects.storage.internal",
        S3_SECRET_ACCESS_KEY: "production-secret-key",
      }),
    ).toThrow("provider egress is enabled");
  });
});
