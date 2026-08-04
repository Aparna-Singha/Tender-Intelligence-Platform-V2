import { describe, expect, it } from "vitest";

import {
  controlledPackageApprovalOutcomeSchema,
  controlledPackageAuditEventTypeSchema,
  controlledPackageDetailSchema,
  controlledPackageDownloadGrantResponseSchema,
  controlledPackageErrorCodeSchema,
  controlledPackageErrorCodes,
  controlledPackageGenerationStatusSchema,
  controlledPackageManifestSchema,
  controlledPackagePreflightResponseSchema,
  controlledPackageProvenanceIndexSchema,
  controlledPackageReviewStatusSchema,
  decideControlledPackageSchema,
  requestControlledPackageDownloadGrantSchema,
  startControlledPackageSchema,
  submitControlledPackageReviewSchema,
} from "./controlled-review-package.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-08-04T12:00:00.000Z";
const hash = "a".repeat(64);

describe("controlled review-package contracts", () => {
  it("serializes locked enums and stable errors", () => {
    expect(controlledPackageGenerationStatusSchema.options).toEqual([
      "QUEUED",
      "PROCESSING",
      "GENERATED",
      "FAILED",
      "CANCELLED",
      "INVALIDATED",
    ]);
    expect(controlledPackageReviewStatusSchema.options).toEqual([
      "NOT_REVIEWED",
      "IN_REVIEW",
      "APPROVED",
      "REJECTED",
      "REVOKED",
      "SUPERSEDED",
    ]);
    expect(
      controlledPackageApprovalOutcomeSchema.parse(
        "APPROVED_FOR_CONTROLLED_DOWNLOAD",
      ),
    ).toBe("APPROVED_FOR_CONTROLLED_DOWNLOAD");
    expect(controlledPackageErrorCodes).toHaveLength(20);
    for (const code of controlledPackageErrorCodes)
      expect(controlledPackageErrorCodeSchema.parse(code)).toBe(code);
    expect(
      controlledPackageAuditEventTypeSchema.parse(
        "CONTROLLED_PACKAGE_DOWNLOAD_GRANT_ISSUED",
      ),
    ).toBeTruthy();
  });

  it("accepts bounded informational preflight", () => {
    expect(
      controlledPackagePreflightResponseSchema.parse({
        eligible_independent_approver_exists: true,
        evaluated_at: timestamp,
        hard_prerequisites_pass: true,
        informational_only: true,
        issues: [],
        policy_version: "controlled-review-package-deterministic-v1",
        qualifying_export_template_version_id: id,
        tender_version_id: otherId,
        transactional_revalidation_required: true,
      }).informational_only,
    ).toBe(true);
  });

  it("rejects client-supplied authority in strict requests", () => {
    const schemas = [
      [
        startControlledPackageSchema,
        { idempotency_key: "package-123", actor_id: id },
      ],
      [
        submitControlledPackageReviewSchema,
        {
          comment: "Reviewed package contents.",
          expected_review_version: 0,
          outcome: "REVIEW_COMPLETE",
          actor_role: "OWNER",
        },
      ],
      [
        decideControlledPackageSchema,
        {
          expected_fingerprint: hash,
          expected_review_version: 1,
          outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD",
          rationale:
            "The controlled review package has been independently reviewed.",
          approval_actor: id,
        },
      ],
      [
        requestControlledPackageDownloadGrantSchema,
        { artifact_id: id, object_key: "private/key" },
      ],
    ] as const;
    for (const [schema, value] of schemas)
      expect(schema.safeParse(value).success).toBe(false);
  });

  it("accepts exactly four safe manifest members", () => {
    const member = (
      kind: string,
      logical_path: string,
      mime_type: string,
    ): Record<string, string | number> => ({
      byte_size: 100,
      kind,
      logical_path,
      mime_type,
      sha256: hash,
    });
    const manifest = controlledPackageManifestSchema.parse({
      approved_draft_version_id: id,
      generated_at: timestamp,
      generation_policy_version: "controlled-review-package-deterministic-v1",
      logical_content_fingerprint: hash,
      members: [
        member("REVIEW_PDF", "review.pdf", "application/pdf"),
        member("MANIFEST_JSON", "manifest.json", "application/json"),
        member("CHECKSUMS_TEXT", "SHA256SUMS.txt", "text/plain"),
        member(
          "PROVENANCE_INDEX_JSON",
          "provenance-index.json",
          "application/json",
        ),
      ],
      organisation_id: id,
      package_id: otherId,
      phase_11_decision_id: id,
      phase_11_readiness_run_id: id,
      schema_version: "controlled-review-package-manifest-v1",
      template_version_id: id,
      tender_id: otherId,
      tender_version_id: otherId,
      warnings: [],
    });
    expect(manifest.members).toHaveLength(4);
    expect(JSON.stringify(manifest)).not.toMatch(
      /object_key|signed_url|draft_text|evidence_value/i,
    );
  });

  it("bounds provenance and rejects unsafe bodies", () => {
    expect(
      controlledPackageProvenanceIndexSchema.parse({
        items: [{ handle: "DOC:1", record_id: id, type: "SOURCE_DOCUMENT" }],
        package_id: otherId,
      }).items,
    ).toHaveLength(1);
    expect(
      controlledPackageProvenanceIndexSchema.safeParse({
        items: [
          {
            handle: "DOC:1",
            record_id: id,
            type: "SOURCE_DOCUMENT",
            source_body: "secret",
          },
        ],
        package_id: otherId,
      }).success,
    ).toBe(false);
  });

  it("keeps detail and download responses free of storage authority", () => {
    const detail = controlledPackageDetailSchema.parse({
      created_at: timestamp,
      freshness: "CURRENT",
      generation_status: "GENERATED",
      id,
      is_current: true,
      policy_version: "controlled-review-package-deterministic-v1",
      requested_by: { display_name: "Requester", user_id: otherId },
      review_status: "APPROVED",
      stale_at: null,
      tender_version_id: otherId,
      updated_at: timestamp,
      failure_code: null,
      input_fingerprint: hash,
      logical_content_fingerprint: hash,
      retry_of_run_id: null,
      template_version_id: id,
    });
    const grant = controlledPackageDownloadGrantResponseSchema.parse({
      artifact_id: id,
      download_path: `/controlled-review-packages/${otherId}/download-grants/${id}`,
      expires_at: timestamp,
      grant_id: otherId,
    });
    expect(JSON.stringify({ detail, grant })).not.toMatch(
      /object_key|signed_url|credential|cookie/i,
    );
  });
});
