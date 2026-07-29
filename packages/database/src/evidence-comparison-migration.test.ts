import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729000800_evidence_comparison/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Phase 7 evidence comparison migration", () => {
  it("creates immutable evidence, snapshot, assessment, link and review tables", () => {
    for (const table of [
      "company_evidence_facts",
      "company_evidence_fact_versions",
      "company_evidence_citations",
      "company_evidence_reviews",
      "eligibility_input_snapshots",
      "eligibility_snapshot_profile_values",
      "eligibility_snapshot_turnover",
      "eligibility_snapshot_document_readiness",
      "eligibility_snapshot_documents",
      "eligibility_snapshot_evidence_facts",
      "eligibility_snapshot_evidence_citations",
      "eligibility_assessment_runs",
      "eligibility_assessments",
      "eligibility_assessment_evidence_links",
      "eligibility_assessment_reviews",
    ])
      expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("adds active-run, idempotency, provenance and tenant indexes", () => {
    expect(migration).toContain("active_eligibility_assessment_run_id");
    expect(migration).toContain(
      "eligibility_assessment_runs_idempotency_key_key",
    );
    expect(migration).toContain(
      "company_evidence_citations_organisation_id_document_id_docu_idx",
    );
    expect(migration).toContain(
      "eligibility_assessments_organisation_id_assessment_run_id",
    );
  });
});
