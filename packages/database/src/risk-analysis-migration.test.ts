import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729000700_early_risk_analysis/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("early risk-analysis migration", () => {
  it.each([
    "risk_analysis_runs",
    "risk_findings",
    "risk_finding_citations",
    "risk_finding_reviews",
    "early_pursuit_decisions",
  ])("creates %s", (table) => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("links findings to exact extraction citations and runs", () => {
    expect(migration).toContain(
      "risk_finding_citations_extraction_citation_id_fkey",
    );
    expect(migration).toContain("risk_analysis_runs_extraction_run_id_fkey");
    expect(migration).toContain("tender_versions_active_early_risk_run_id_key");
  });

  it("indexes tenant queries and preserves idempotency", () => {
    expect(migration).toContain("risk_analysis_runs_idempotency_key_key");
    expect(migration).toContain(
      "risk_findings_organisation_id_risk_analysis_run_id_severity_idx",
    );
  });
});
