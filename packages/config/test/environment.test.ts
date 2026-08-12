import { describe, expect, it } from "vitest";

import {
  apiEnvironmentSchema,
  EnvironmentValidationError,
  parseEnvironment,
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
});
