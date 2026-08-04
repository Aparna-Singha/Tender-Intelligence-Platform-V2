import { describe, expect, it } from "vitest";

import {
  controlledPackageApprovalOutcomeSchema,
  controlledPackageAuditEventTypeSchema,
  controlledPackageDetailSchema,
  controlledPackageDownloadGrantResponseSchema,
  controlledPackageEmbeddedManifestSchema,
  controlledPackageErrorCodeSchema,
  controlledPackageErrorCodes,
  controlledPackageGenerationStatusSchema,
  controlledPackageManifestSchema,
  controlledPackagePreflightResponseSchema,
  controlledPackageProvenanceIndexSchema,
  controlledPackageReviewStatusSchema,
  controlledPackageApprovalHistorySchema,
  controlledPackageReviewHistorySchema,
  decideControlledPackageSchema,
  requestControlledPackageDownloadGrantSchema,
  startControlledPackageSchema,
  submitControlledPackageReviewSchema,
} from "./controlled-review-package.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-08-04T12:00:00.000Z";
const hash = "a".repeat(64);

const preflight = (active_run: unknown): Record<string, unknown> => ({
  active_run,
  eligible_independent_approver_exists: true,
  evaluated_at: timestamp,
  hard_prerequisites_pass: true,
  informational_only: true,
  issues: [],
  policy_version: "controlled-review-package-deterministic-v1",
  qualifying_export_template_version_id: id,
  tender_version_id: otherId,
  transactional_revalidation_required: true,
});

const activeRun = {
  details_path: `/organisations/${id}/tenders/${otherId}/controlled-review-packages/${id}`,
  freshness: "CURRENT",
  generation_status: "QUEUED",
  id,
  progress_path: `/organisations/${id}/tenders/${otherId}/controlled-review-packages/${id}/progress`,
  review_status: "NOT_REVIEWED",
};

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
      controlledPackagePreflightResponseSchema.parse(preflight(null))
        .informational_only,
    ).toBe(true);
  });

  it("accepts complete safe metadata for active generation states", () => {
    for (const generation_status of ["QUEUED", "PROCESSING"] as const) {
      const parsed = controlledPackagePreflightResponseSchema.parse(
        preflight({ ...activeRun, generation_status }),
      );
      expect(parsed.active_run).toMatchObject({ generation_status, id });
    }
  });

  it("requires complete strict active-run metadata", () => {
    expect(
      controlledPackagePreflightResponseSchema.safeParse(
        preflight({ ...activeRun, progress_path: undefined }),
      ).success,
    ).toBe(false);
    expect(
      controlledPackagePreflightResponseSchema.safeParse(
        preflight({ ...activeRun, actor_id: otherId }),
      ).success,
    ).toBe(false);
    expect(
      controlledPackagePreflightResponseSchema.safeParse({
        ...preflight(activeRun),
        queue_job_id: id,
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe active-run identifiers and navigation paths", () => {
    const invalidValues = [
      { ...activeRun, id: "not-a-uuid" },
      { ...activeRun, details_path: "https://example.com/package" },
      { ...activeRun, details_path: "packages/detail" },
      { ...activeRun, progress_path: "/packages/has whitespace" },
      { ...activeRun, progress_path: `/${"a".repeat(301)}` },
    ];
    for (const value of invalidValues)
      expect(
        controlledPackagePreflightResponseSchema.safeParse(preflight(value))
          .success,
      ).toBe(false);
  });

  it("rejects authority-bearing or sensitive active-run fields", () => {
    for (const field of [
      "actor_id",
      "actor_role",
      "membership_id",
      "input_fingerprint",
      "object_key",
      "signed_url",
    ])
      expect(
        controlledPackagePreflightResponseSchema.safeParse(
          preflight({ ...activeRun, [field]: "unsafe" }),
        ).success,
      ).toBe(false);
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

  it("enforces the acyclic embedded manifest contract", () => {
    const embedded = {
      generated_at: timestamp,
      generation_policy_version: "controlled-review-package-deterministic-v1",
      logical_content_fingerprint: hash,
      members: [
        {
          byte_size: 10,
          kind: "REVIEW_PDF",
          logical_path: "review.pdf",
          mime_type: "application/pdf",
          sha256: hash,
        },
        {
          byte_size: 10,
          kind: "MANIFEST_JSON",
          logical_path: "manifest.json",
          mime_type: "application/json",
        },
        {
          byte_size: 10,
          kind: "CHECKSUMS_TEXT",
          logical_path: "SHA256SUMS.txt",
          mime_type: "text/plain",
          sha256: hash,
        },
        {
          byte_size: 10,
          kind: "PROVENANCE_INDEX_JSON",
          logical_path: "provenance-index.json",
          mime_type: "application/json",
          sha256: hash,
        },
      ],
      organisation_id: id,
      package_id: otherId,
      phase_11_decision_id: id,
      phase_11_readiness_run_id: id,
      renderer_compatibility_version:
        "controlled-review-package-renderer-compatibility-v1",
      schema_version: "controlled-review-package-embedded-manifest-v1",
      template_version_id: id,
      tender_id: otherId,
      tender_version_id: otherId,
      warnings: [],
    } as const;
    expect(
      controlledPackageEmbeddedManifestSchema.parse(embedded).members,
    ).toHaveLength(4);
    const manifestMember = embedded.members[1];
    expect(manifestMember).not.toHaveProperty("sha256");
    expect(
      controlledPackageEmbeddedManifestSchema.safeParse({
        ...embedded,
        object_key: "private/key",
      }).success,
    ).toBe(false);
    expect(
      controlledPackageEmbeddedManifestSchema.safeParse({
        ...embedded,
        members: embedded.members.map((member, index) =>
          index === 1 ? { ...member, sha256: hash } : member,
        ),
      }).success,
    ).toBe(false);
    expect(
      controlledPackageEmbeddedManifestSchema.safeParse({
        ...embedded,
        members: embedded.members.map((member, index) =>
          index === 0 ? { ...member, sha256: undefined } : member,
        ),
      }).success,
    ).toBe(false);
    expect(
      controlledPackageEmbeddedManifestSchema.safeParse({
        ...embedded,
        members: embedded.members.map((member, index) =>
          index === 1
            ? {
                ...member,
                kind: "REVIEW_PDF",
                mime_type: "application/pdf",
                sha256: hash,
              }
            : member,
        ),
      }).success,
    ).toBe(false);
    expect(
      controlledPackageEmbeddedManifestSchema.safeParse({
        ...embedded,
        members: embedded.members.map((member, index) =>
          index === 1 ? { ...member, logical_path: "review.pdf" } : member,
        ),
      }).success,
    ).toBe(false);
    expect(
      controlledPackageEmbeddedManifestSchema.safeParse({
        ...embedded,
        members: embedded.members.map((member, index) =>
          index === 0
            ? { ...member, logical_path: "nested/review.pdf" }
            : member,
        ),
      }).success,
    ).toBe(false);
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
      artifact_id: id,
      created_at: timestamp,
      freshness: "CURRENT",
      generation_status: "GENERATED",
      id,
      is_current: true,
      policy_version: "controlled-review-package-deterministic-v1",
      requested_by: {
        display_name: "Requester",
        role_at_action: "OWNER",
        user_id: otherId,
      },
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

  it("requires persisted organisation roles on package actors", () => {
    const roles = [
      "OWNER",
      "ADMIN",
      "TENDER_EXECUTIVE",
      "CONSULTANT",
      "REVIEWER",
    ] as const;
    for (const role_at_action of roles) {
      const review = controlledPackageReviewHistorySchema.parse({
        items: [
          {
            actor: {
              display_name: "Historical actor",
              role_at_action,
              user_id: id,
            },
            comment: "The generated package was reviewed.",
            created_at: timestamp,
            id,
            outcome: "REVIEW_COMPLETE",
            review_version: 1,
          },
        ],
        next_cursor: null,
      });
      expect(review.items[0]?.actor.role_at_action).toBe(role_at_action);
    }

    const approval = {
      actor: {
        display_name: "Historical actor",
        role_at_action: "REVIEWER",
        user_id: id,
      },
      created_at: timestamp,
      id,
      outcome: "APPROVED_FOR_CONTROLLED_DOWNLOAD",
      rationale:
        "The package was independently reviewed for controlled download.",
      revoked_at: null,
      superseded_at: null,
    };
    expect(
      controlledPackageApprovalHistorySchema.parse({ items: [approval] })
        .items[0]?.actor.role_at_action,
    ).toBe("REVIEWER");
    for (const invalidActor of [
      { display_name: "Actor", user_id: id },
      {
        display_name: "Actor",
        role_at_action: "PLATFORM_ADMIN",
        user_id: id,
      },
      { display_name: "Actor", role_at_action: "UNKNOWN", user_id: id },
      {
        display_name: "Actor",
        membership_id: otherId,
        role_at_action: "OWNER",
        user_id: id,
      },
    ]) {
      expect(
        controlledPackageApprovalHistorySchema.safeParse({
          items: [{ ...approval, actor: invalidActor }],
        }).success,
      ).toBe(false);
      expect(
        controlledPackageReviewHistorySchema.safeParse({
          items: [
            {
              actor: invalidActor,
              comment: "The generated package was reviewed.",
              created_at: timestamp,
              id,
              outcome: "REVIEW_COMPLETE",
              review_version: 1,
            },
          ],
          next_cursor: null,
        }).success,
      ).toBe(false);
    }
  });
});
