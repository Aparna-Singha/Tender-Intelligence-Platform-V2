import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729000900_missing_action_checklist/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Phase 8 migration", () => {
  it("creates tenant-scoped checklist runs, provenance links, and history", () => {
    for (const table of [
      "checklist_generation_runs",
      "checklist_items",
      "checklist_item_assessment_links",
      "checklist_item_requirement_links",
      "checklist_item_source_citations",
      "checklist_item_history",
    ])
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    expect(migration).toContain("checklist_one_active_run_per_version");
    expect(migration).toContain(
      'FOREIGN KEY ("eligibility_assessment_id") REFERENCES "eligibility_assessments"',
    );
  });
});
