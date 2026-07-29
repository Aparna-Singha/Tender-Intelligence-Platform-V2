import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729001100_fact_constrained_drafting/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("fact-constrained drafting migration", () => {
  it("creates immutable snapshots, templates, drafts and review history", () => {
    for (const table of [
      "draft_generation_runs",
      "draft_input_snapshots",
      "draft_input_snapshot_sources",
      "draft_templates",
      "draft_template_versions",
      "drafts",
      "draft_versions",
      "draft_sections",
      "draft_claims",
      "draft_claim_citations",
      "draft_placeholders",
      "draft_human_inputs",
      "draft_reviews",
      "draft_review_events",
    ])
      expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("enforces tenant-scoped parent relationships", () => {
    expect(migration).toContain("draft_generation_runs_tender_scope_fkey");
    expect(migration).toContain("draft_snapshot_sources_scope_fkey");
    expect(migration).toContain("draft_versions_draft_scope_fkey");
    expect(migration).toContain("draft_review_events_version_scope_fkey");
  });

  it("adds idempotency, invalidation and human-review controls", () => {
    expect(migration).toContain("draft_generation_runs_idempotency_key_key");
    expect(migration).toContain('"invalidated_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('"approval_blocking" BOOLEAN NOT NULL');
    expect(migration).toContain("DRAFT_VERSION_APPROVED");
  });
});
