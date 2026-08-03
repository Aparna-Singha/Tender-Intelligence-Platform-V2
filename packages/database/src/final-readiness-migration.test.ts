import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260729001200_phase_11_final_readiness/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("immutable final-readiness migration", () => {
  it.each([
    "final_readiness_runs",
    "final_readiness_input_snapshots",
    "final_readiness_snapshot_documents",
    "final_readiness_snapshot_required_drafts",
    "final_readiness_findings",
    "final_readiness_finding_provenance",
    "final_readiness_finding_reviews",
    "final_readiness_decisions",
    "final_readiness_decision_acknowledgements",
  ])("creates %s", (table) => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("creates the locked enums without duplicating risk vocabulary", () => {
    expect(migration).toContain(
      "CREATE TYPE \"FinalReadinessTreatment\" AS ENUM ('BLOCKER', 'HUMAN_DISPOSITION_REQUIRED', 'WARNING', 'INFORMATIONAL')",
    );
    expect(migration).toContain(
      "CREATE TYPE \"FinalReadinessDisposition\" AS ENUM ('PROCEED_TO_CONTROLLED_EXPORT_REVIEW', 'HOLD_FOR_REMEDIATION', 'STOP_PURSUIT')",
    );
    expect(migration).not.toContain('CREATE TYPE "FinalReadinessRiskSeverity"');
    expect(schema).toMatch(
      /enum RiskAnalysisGate\s*{\s*EARLY\s*FINAL_READINESS\s*}/,
    );
  });

  it("enforces one snapshot and one linked final-risk run", () => {
    expect(migration).toContain("final_readiness_input_snapshots_run_id_key");
    expect(migration).toContain(
      "risk_analysis_runs_final_readiness_run_id_key",
    );
    expect(migration).toContain(
      "risk_analysis_runs_final_readiness_run_id_fkey",
    );
    expect(schema).not.toMatch(
      /model FinalReadinessInputSnapshot[\s\S]*finalRiskRunId/,
    );
  });

  it("adds the active pointer and one in-progress operation invariant", () => {
    expect(migration).toContain('"active_final_readiness_run_id" UUID');
    expect(migration).toContain(
      "tender_versions_active_final_readiness_scope_fkey",
    );
    expect(migration).toContain(
      "final_readiness_one_in_progress_per_version_idx",
    );
    expect(migration).toContain("WHERE \"status\" IN ('QUEUED', 'PROCESSING')");
  });

  it("enforces scoped idempotency and immutable snapshot uniqueness", () => {
    expect(migration).toContain(
      "final_readiness_runs_organisation_id_tender_id_idempotency__key",
    );
    expect(migration).toContain(
      "final_readiness_snapshot_documents_snapshot_id_tender_docum_key",
    );
    expect(migration).toContain(
      "final_readiness_snapshot_required_drafts_snapshot_id_draft__key",
    );
    expect(migration).toContain("final_readiness_required_draft_type_check");
  });

  it("requires exactly one typed relational provenance source", () => {
    expect(migration).toContain(
      "final_readiness_provenance_exactly_one_source_check",
    );
    expect(migration).toContain("num_nonnulls(");
    expect(migration).toContain(
      "final_readiness_provenance_kind_matches_source_check",
    );
    expect(migration).toContain(
      "final_readiness_provenance_extraction_unique_idx",
    );
    expect(migration).not.toContain('"source_body"');
  });

  it("allows only one unsuperseded decision per run", () => {
    expect(migration).toContain(
      "final_readiness_one_current_decision_per_run_idx",
    );
    expect(migration).toContain('WHERE "superseded_at" IS NULL');
    expect(migration).toContain("final_readiness_decision_actor_role_check");
  });

  it("adds tenant and tender scope protections", () => {
    for (const constraint of [
      "final_readiness_snapshot_run_scope_fkey",
      "final_readiness_findings_run_scope_fkey",
      "final_readiness_decisions_run_scope_fkey",
      "final_readiness_reviews_finding_scope_fkey",
      "risk_analysis_final_readiness_scope_fkey",
    ])
      expect(migration).toContain(constraint);
  });

  it("uses restrictive deletion for authoritative provenance", () => {
    for (const table of [
      "extraction_citations",
      "risk_findings",
      "eligibility_assessments",
      "company_evidence_fact_versions",
      "draft_versions",
    ])
      expect(migration).toMatch(
        new RegExp(`REFERENCES "${table}"\\("id"\\) ON DELETE RESTRICT`),
      );
  });

  it("adds nullable role-at-action evidence without fabricating history", () => {
    expect(migration).toContain(
      'ALTER TABLE "draft_review_events" ADD COLUMN     "actor_role_at_action" "Role";',
    );
    expect(migration).not.toMatch(
      /UPDATE\s+"draft_review_events"[\s\S]*actor_role_at_action/i,
    );
  });

  it("does not add Phase 12 export persistence", () => {
    expect(migration).not.toMatch(
      /CREATE TABLE "(?:export|submission|signed_download)/i,
    );
    expect(schema).not.toMatch(
      /model (?:ExportManifest|Submission|SignedExportDownload)/,
    );
  });
});
