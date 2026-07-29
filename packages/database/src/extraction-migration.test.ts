import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729000600_tender_parsing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("tender extraction migration", () => {
  it.each([
    "extraction_runs",
    "extraction_run_documents",
    "extracted_units",
    "extracted_blocks",
    "extracted_tables",
    "extracted_table_cells",
    "classified_sections",
    "extracted_tender_fields",
    "structured_requirements",
    "extraction_citations",
    "extraction_issues",
    "extraction_reviews",
  ])("creates %s", (table) => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("enforces progress, source locations, and a single citation target", () => {
    expect(migration).toContain("extraction_runs_progress_percentage_check");
    expect(migration).toContain("extraction_citations_offsets_check");
    expect(migration).toContain("extraction_citations_target_check");
  });

  it("keeps runs immutable while allowing explicit reruns", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "extraction_runs_idempotency_key_key"',
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "extraction_runs_organisation_id_tender_version_id_source',
    );
  });
});
