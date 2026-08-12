import { describe, expect, it } from "vitest";

import {
  comparePostgresEnv,
  findPlaceholderKeys,
  parseDotEnv,
  redact,
} from "../../../tools/doctor.mjs";

describe("doctor diagnostics", () => {
  it("parses dotenv values without printing the original file", () => {
    expect(
      parseDotEnv(`
DATABASE_URL="postgresql://user:secret@localhost:5432/db"
REDIS_URL=redis://localhost:6379
# ignored
`),
    ).toEqual({
      DATABASE_URL: "postgresql://user:secret@localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
    });
  });

  it("compares PostgreSQL environment values with URL decoding", () => {
    expect(
      comparePostgresEnv({
        DATABASE_URL:
          "postgresql://tender_platform:p%40ss%20word@localhost:5432/tender_intelligence",
        POSTGRES_DB: "tender_intelligence",
        POSTGRES_PASSWORD: "p@ss word",
        POSTGRES_USER: "tender_platform",
      }),
    ).toEqual([]);
    expect(
      comparePostgresEnv({
        DATABASE_URL: "postgresql://other:p%40ss%20word@localhost:5432/db",
        POSTGRES_DB: "db",
        POSTGRES_PASSWORD: "p@ss word",
        POSTGRES_USER: "tender_platform",
      }),
    ).toContain("DATABASE_URL username differs from POSTGRES_USER.");
  });

  it("finds unresolved secret placeholders", () => {
    expect(
      findPlaceholderKeys({
        COOKIE_SECRET: "replace-with-a-random-local-cookie-secret",
        DATABASE_URL: "postgresql://user:replace-with-password@localhost/db",
        LOG_LEVEL: "info",
      }),
    ).toEqual(["COOKIE_SECRET"]);
  });

  it("redacts passwords and secret query values", () => {
    const output = redact(
      "postgresql://user:super-secret@localhost/db?api_key=provider-secret",
    );
    expect(output).toContain("postgresql://user:<redacted>@localhost/db");
    expect(output).toContain("api_key=<redacted>");
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("provider-secret");
  });
});
