import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729000400_company_document_vault/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("document vault migration", () => {
  it.each([
    "documents",
    "document_versions",
    "upload_sessions",
    "document_extractions",
    "document_verifications",
    "document_access_events",
  ])("creates %s", (table) => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("enforces checksum shape and positive binary size", () => {
    expect(migration).toContain("document_versions_valid_sha256");
    expect(migration).toContain("document_versions_positive_size");
  });
});
