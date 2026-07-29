import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260729000300_progressive_onboarding/migration.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

describe("progressive onboarding migration contract", () => {
  it("creates structured profile, turnover and document-readiness tables", () => {
    expect(migration).toContain('CREATE TABLE "company_profile_values"');
    expect(migration).toContain('CREATE TABLE "company_turnover"');
    expect(migration).toContain('CREATE TABLE "document_readiness"');
    expect(migration).toContain(
      'ALTER TABLE "company_profiles" DROP COLUMN "profile_data"',
    );
  });

  it("records provenance and verification metadata for profile values", () => {
    for (const column of [
      '"source"',
      '"verification_status"',
      '"evidence_document_id"',
      '"updated_at"',
      '"updated_by_user_id"',
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain('"company_profile_values_exactly_one_value"');
  });
});
