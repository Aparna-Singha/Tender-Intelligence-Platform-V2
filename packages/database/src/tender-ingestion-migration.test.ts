import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729000500_manual_tender_ingestion/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("manual tender ingestion migration", () => {
  it.each([
    "tenders",
    "tender_versions",
    "tender_documents",
    "tender_sources",
    "tender_corrigenda",
    "tender_workspaces",
    "processing_jobs",
  ])("creates %s", (table) => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("enforces bounded source sizes, checksums, and progress", () => {
    expect(migration).toContain("tender_documents_positive_size");
    expect(migration).toContain("tender_documents_valid_sha256");
    expect(migration).toContain("processing_jobs_valid_progress");
    expect(migration).toContain("tender_workspaces_valid_progress");
  });
});
