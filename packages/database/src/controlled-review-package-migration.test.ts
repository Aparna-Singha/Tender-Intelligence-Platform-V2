import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20260804000100_phase_12_controlled_review_package/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const schema = readFileSync(
  new URL("../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("controlled review-package migration", () => {
  it.each([
    "export_templates",
    "export_template_versions",
    "controlled_review_package_runs",
    "controlled_review_package_input_snapshots",
    "controlled_package_snapshot_documents",
    "controlled_package_snapshot_provenance",
    "package_artifacts",
    "package_manifests",
    "package_manifest_members",
    "package_reviews",
    "package_approvals",
    "package_download_grants",
  ])("creates %s", (table) => {
    expect(migration).toContain(`CREATE TABLE "${table}"`);
  });

  it("uses the locked independent state types", () => {
    expect(migration).toContain(
      "CREATE TYPE \"ControlledPackageGenerationStatus\" AS ENUM ('QUEUED', 'PROCESSING', 'GENERATED', 'FAILED', 'CANCELLED', 'INVALIDATED')",
    );
    expect(migration).toContain(
      "CREATE TYPE \"ControlledPackageReviewStatus\" AS ENUM ('NOT_REVIEWED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'SUPERSEDED')",
    );
    expect(schema).toContain("staleAt");
  });

  it("enforces scoped idempotency, active work and current authority", () => {
    expect(migration).toContain("controlled_package_runs_idempotency_key");
    expect(migration).toContain(
      "controlled_package_one_active_run_per_version_idx",
    );
    expect(migration).toContain(
      "WHERE \"generation_status\" IN ('QUEUED', 'PROCESSING')",
    );
    expect(migration).toContain(
      "tender_versions_current_controlled_package_run_id_key",
    );
    expect(migration).toContain(
      "tender_versions_current_controlled_package_scope_fkey",
    );
  });

  it("pins Phase 11 authority and approved materials", () => {
    for (const constraint of [
      "controlled_package_snapshot_final_readiness_run_fkey",
      "controlled_package_snapshot_final_risk_run_fkey",
      "controlled_package_snapshot_readiness_decision_fkey",
      "controlled_package_snapshot_readiness_snapshot_fkey",
      "controlled_package_snapshot_draft_version_fkey",
      "controlled_package_snapshot_draft_approval_fkey",
      "controlled_package_snapshot_template_version_fkey",
    ])
      expect(migration).toContain(constraint);
  });

  it("requires one immutable snapshot and restrictive history", () => {
    expect(migration).toContain(
      "controlled_package_input_snapshots_run_id_key",
    );
    expect(migration).not.toMatch(
      /(?:package_reviews|package_approvals|package_download_grants)[\s\S]{0,300}ON DELETE CASCADE/,
    );
    expect(migration).toContain("controlled_package_runs_retry_of_run_id_fkey");
  });

  it("enforces typed provenance and tenant scope", () => {
    expect(migration).toContain(
      "controlled_package_provenance_exactly_one_source_check",
    );
    expect(migration).toContain("num_nonnulls(");
    expect(migration).toContain(
      "controlled_package_provenance_kind_matches_source_check",
    );
    expect(migration).toContain(
      "controlled_package_snapshot_provenance_scope_fkey",
    );
    expect(migration).not.toContain('"source_body"');
  });

  it("enforces artifact, manifest and grant constraints", () => {
    for (const constraint of [
      "package_artifact_byte_size_check",
      "package_artifact_checksum_check",
      "package_artifact_promotion_check",
      "package_member_byte_size_check",
      "package_member_path_check",
      "package_download_grant_expiry_check",
    ])
      expect(migration).toContain(constraint);
    expect(migration).not.toMatch(/signed_url|presigned_url|access_key/i);
  });

  it("allows only one effective approval and preserves role evidence", () => {
    expect(migration).toContain("package_one_effective_approval_per_run_idx");
    expect(migration).toContain("package_approval_role_check");
    expect(schema).toContain("actorRoleAtAction");
    expect(schema).toContain("requesterRoleAtAction");
  });
});

describe.runIf(Boolean(process.env.DATABASE_URL))(
  "deployed controlled package database",
  () => {
    let pool: Pool;

    beforeAll(() => {
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    it("has every authoritative table in PostgreSQL", async () => {
      const result = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE '%package%'
         ORDER BY table_name`,
      );
      expect(result.rows.map((row) => row.table_name)).toEqual(
        expect.arrayContaining([
          "controlled_review_package_runs",
          "controlled_review_package_input_snapshots",
          "package_artifacts",
          "package_manifests",
          "package_reviews",
          "package_approvals",
          "package_download_grants",
        ]),
      );
    });

    it("has database-enforced scope, limit and concurrency protections", async () => {
      const result = await pool.query<{ name: string }>(
        `SELECT conname AS name FROM pg_constraint
         WHERE conname LIKE 'controlled_package_%'
            OR conname LIKE 'package_%'
         UNION
         SELECT indexname AS name FROM pg_indexes
         WHERE schemaname = 'public'
           AND (indexname LIKE 'controlled_package_%'
             OR indexname LIKE 'package_%')`,
      );
      const names = result.rows.map((row) => row.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "controlled_package_snapshot_run_scope_fkey",
          "controlled_package_one_active_run_per_version_idx",
          "controlled_package_input_snapshots_run_id_key",
          "package_one_effective_approval_per_run_idx",
          "package_download_grant_expiry_check",
        ]),
      );
    });
  },
);
