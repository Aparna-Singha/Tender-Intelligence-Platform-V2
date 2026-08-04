import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const idempotencyKeySchema = z.string().trim().min(8).max(120);
const rationaleSchema = z.string().trim().min(20).max(2_000);
const commentSchema = z.string().trim().min(1).max(2_000);
const safeDisplaySchema = z.string().trim().min(1).max(240);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const relativeApiPathSchema = z.string().regex(/^\/[^\s]{1,300}$/);
const safeCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/)
  .max(120);

export const controlledPackageGenerationStatusSchema = z.enum([
  "QUEUED",
  "PROCESSING",
  "GENERATED",
  "FAILED",
  "CANCELLED",
  "INVALIDATED",
]);
export const controlledPackageReviewStatusSchema = z.enum([
  "NOT_REVIEWED",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "REVOKED",
  "SUPERSEDED",
]);
export const controlledPackageFreshnessSchema = z.enum([
  "CURRENT",
  "STALE",
  "INVALIDATED",
]);
export const controlledPackageArtifactKindSchema = z.enum(["PACKAGE_ZIP"]);
export const controlledPackageMemberKindSchema = z.enum([
  "REVIEW_PDF",
  "MANIFEST_JSON",
  "CHECKSUMS_TEXT",
  "PROVENANCE_INDEX_JSON",
]);
export const controlledPackageReviewOutcomeSchema = z.enum([
  "COMMENTED",
  "REVIEW_COMPLETE",
]);
export const controlledPackageApprovalOutcomeSchema = z.enum([
  "APPROVED_FOR_CONTROLLED_DOWNLOAD",
  "REJECTED",
]);
export const controlledPackageRevocationReasonSchema = z.enum([
  "AUTHORITATIVE_INPUT_CHANGED",
  "APPROVAL_WITHDRAWN",
  "ARTIFACT_INTEGRITY_FAILURE",
  "SECURITY_CONCERN",
  "SUPERSEDED",
]);
export const controlledPackageProvenanceTypeSchema = z.enum([
  "SOURCE_DOCUMENT",
  "EXTRACTION_CITATION",
  "RISK_FINDING",
  "ELIGIBILITY_ASSESSMENT",
  "EVIDENCE_FACT_VERSION",
  "EVIDENCE_CITATION",
  "CHECKLIST_ITEM",
  "DRAFT_VERSION",
  "DRAFT_CLAIM",
  "DRAFT_CITATION",
  "FINAL_READINESS_FINDING",
]);
export const controlledPackageLifecycleEventSchema = z.enum([
  "GENERATION_REQUESTED",
  "GENERATION_STARTED",
  "GENERATION_COMPLETED",
  "GENERATION_FAILED",
  "CANCELLATION_REQUESTED",
  "CANCELLED",
  "INVALIDATED",
  "REVIEWED",
  "APPROVED",
  "REJECTED",
  "REVOKED",
  "SUPERSEDED",
  "DOWNLOAD_GRANT_ISSUED",
]);
export const controlledPackageAuditEventTypeSchema = z.enum([
  "CONTROLLED_PACKAGE_PREFLIGHT_EVALUATED",
  "CONTROLLED_PACKAGE_GENERATION_REQUESTED",
  "CONTROLLED_PACKAGE_GENERATION_STARTED",
  "CONTROLLED_PACKAGE_GENERATION_COMPLETED",
  "CONTROLLED_PACKAGE_GENERATION_FAILED",
  "CONTROLLED_PACKAGE_CANCELLED",
  "CONTROLLED_PACKAGE_REGENERATED",
  "CONTROLLED_PACKAGE_REVIEWED",
  "CONTROLLED_PACKAGE_APPROVED",
  "CONTROLLED_PACKAGE_REJECTED",
  "CONTROLLED_PACKAGE_INVALIDATED",
  "CONTROLLED_PACKAGE_REVOKED",
  "CONTROLLED_PACKAGE_DOWNLOAD_GRANT_ISSUED",
  "CONTROLLED_PACKAGE_DOWNLOAD_STARTED",
  "CONTROLLED_PACKAGE_DOWNLOAD_COMPLETED",
]);

export const controlledPackageErrorCodes = [
  "CONTROLLED_PACKAGE_PREREQUISITES_NOT_CURRENT",
  "CONTROLLED_PACKAGE_PROCEED_DECISION_REQUIRED",
  "CONTROLLED_PACKAGE_ALREADY_ACTIVE",
  "CONTROLLED_PACKAGE_IDEMPOTENCY_CONFLICT",
  "CONTROLLED_PACKAGE_STALE",
  "CONTROLLED_PACKAGE_INVALIDATED",
  "CONTROLLED_PACKAGE_NOT_GENERATED",
  "CONTROLLED_PACKAGE_REVIEW_REQUIRED",
  "CONTROLLED_PACKAGE_APPROVAL_BLOCKED",
  "CONTROLLED_PACKAGE_SEPARATION_OF_DUTIES_REQUIRED",
  "CONTROLLED_PACKAGE_REVOKED",
  "CONTROLLED_PACKAGE_DOWNLOAD_EXPIRED",
  "CONTROLLED_PACKAGE_DOWNLOAD_NOT_AUTHORISED",
  "CONTROLLED_PACKAGE_ARTIFACT_UNAVAILABLE",
  "CONTROLLED_PACKAGE_NOT_RETRYABLE",
  "CONTROLLED_PACKAGE_UNSAFE_SOURCE",
  "CONTROLLED_PACKAGE_SIZE_LIMIT_EXCEEDED",
  "CONTROLLED_PACKAGE_DOCUMENT_LIMIT_EXCEEDED",
  "CONTROLLED_PACKAGE_PROVENANCE_LIMIT_EXCEEDED",
  "CONTROLLED_PACKAGE_CONCURRENCY_CONFLICT",
] as const;
export const controlledPackageErrorCodeSchema = z.enum(
  controlledPackageErrorCodes,
);

const actorSchema = z
  .object({ display_name: safeDisplaySchema, user_id: uuidSchema })
  .strict();
const pageSchema = z
  .object({
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const prerequisiteIssueSchema = z
  .object({
    code: safeCodeSchema,
    treatment: z.enum([
      "HARD_GENERATION_BLOCKER",
      "PACKAGE_WARNING",
      "REVIEW_BLOCKER",
      "DOWNLOAD_BLOCKER",
    ]),
  })
  .strict();

export const controlledPackagePreflightResponseSchema = z
  .object({
    active_run: z
      .object({
        details_path: relativeApiPathSchema,
        freshness: controlledPackageFreshnessSchema,
        generation_status: controlledPackageGenerationStatusSchema,
        id: uuidSchema,
        progress_path: relativeApiPathSchema,
        review_status: controlledPackageReviewStatusSchema,
      })
      .strict()
      .nullable(),
    eligible_independent_approver_exists: z.boolean(),
    evaluated_at: timestampSchema,
    hard_prerequisites_pass: z.boolean(),
    informational_only: z.literal(true),
    issues: z.array(prerequisiteIssueSchema).max(200),
    policy_version: z.literal("controlled-review-package-deterministic-v1"),
    qualifying_export_template_version_id: uuidSchema.nullable(),
    tender_version_id: uuidSchema,
    transactional_revalidation_required: z.literal(true),
  })
  .strict();

export const startControlledPackageSchema = z
  .object({ idempotency_key: idempotencyKeySchema })
  .strict();
export const cancelControlledPackageSchema = z
  .object({ rationale: rationaleSchema })
  .strict();
export const retryControlledPackageSchema = z
  .object({ idempotency_key: idempotencyKeySchema, rationale: rationaleSchema })
  .strict();
export const controlledPackagePaginationSchema = pageSchema;

export const controlledPackageSummarySchema = z
  .object({
    created_at: timestampSchema,
    freshness: controlledPackageFreshnessSchema,
    generation_status: controlledPackageGenerationStatusSchema,
    id: uuidSchema,
    is_current: z.boolean(),
    policy_version: z.literal("controlled-review-package-deterministic-v1"),
    requested_by: actorSchema,
    review_status: controlledPackageReviewStatusSchema,
    stale_at: timestampSchema.nullable(),
    tender_version_id: uuidSchema,
    updated_at: timestampSchema,
  })
  .strict();
export const controlledPackageCurrentResponseSchema = z
  .object({ package: controlledPackageSummarySchema.nullable() })
  .strict();
export const controlledPackageHistoryResponseSchema = z
  .object({
    items: z.array(controlledPackageSummarySchema).max(100),
    next_cursor: uuidSchema.nullable(),
  })
  .strict();
export const controlledPackageDetailSchema = controlledPackageSummarySchema
  .extend({
    failure_code: safeCodeSchema.nullable(),
    input_fingerprint: fingerprintSchema,
    logical_content_fingerprint: fingerprintSchema.nullable(),
    retry_of_run_id: uuidSchema.nullable(),
    template_version_id: uuidSchema,
  })
  .strict();
export const controlledPackageLifecycleResponseSchema = z
  .object({
    events: z
      .array(
        z
          .object({
            event: controlledPackageLifecycleEventSchema,
            occurred_at: timestampSchema,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

export const controlledPackageManifestMemberSchema = z
  .object({
    byte_size: z
      .number()
      .int()
      .nonnegative()
      .max(50 * 1024 * 1024),
    kind: controlledPackageMemberKindSchema,
    logical_path: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
    mime_type: z.enum(["application/pdf", "application/json", "text/plain"]),
    sha256: sha256Schema,
  })
  .strict();
export const controlledPackageManifestSchema = z
  .object({
    approved_draft_version_id: uuidSchema,
    generated_at: timestampSchema,
    generation_policy_version: z.literal(
      "controlled-review-package-deterministic-v1",
    ),
    logical_content_fingerprint: fingerprintSchema,
    members: z.array(controlledPackageManifestMemberSchema).length(4),
    organisation_id: uuidSchema,
    package_id: uuidSchema,
    phase_11_decision_id: uuidSchema,
    phase_11_readiness_run_id: uuidSchema,
    schema_version: z.literal("controlled-review-package-manifest-v1"),
    template_version_id: uuidSchema,
    tender_id: uuidSchema,
    tender_version_id: uuidSchema,
    warnings: z.array(safeCodeSchema).max(200),
  })
  .strict();

export const controlledPackageProvenanceReferenceSchema = z
  .object({
    display_label: safeDisplaySchema.optional(),
    handle: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/),
    record_id: uuidSchema,
    type: controlledPackageProvenanceTypeSchema,
  })
  .strict();
export const controlledPackageProvenanceIndexSchema = z
  .object({
    items: z.array(controlledPackageProvenanceReferenceSchema).max(5_000),
    package_id: uuidSchema,
  })
  .strict();

export const submitControlledPackageReviewSchema = z
  .object({
    comment: commentSchema,
    expected_review_version: z.number().int().nonnegative(),
    outcome: controlledPackageReviewOutcomeSchema,
  })
  .strict();
export const controlledPackageReviewRecordSchema = z
  .object({
    actor: actorSchema,
    comment: commentSchema,
    created_at: timestampSchema,
    id: uuidSchema,
    outcome: controlledPackageReviewOutcomeSchema,
    review_version: z.number().int().positive(),
  })
  .strict();
export const controlledPackageReviewHistorySchema = z
  .object({
    items: z.array(controlledPackageReviewRecordSchema).max(100),
    next_cursor: uuidSchema.nullable(),
  })
  .strict();

export const decideControlledPackageSchema = z
  .object({
    expected_fingerprint: fingerprintSchema,
    expected_review_version: z.number().int().nonnegative(),
    outcome: controlledPackageApprovalOutcomeSchema,
    rationale: rationaleSchema,
  })
  .strict();
export const controlledPackageApprovalRecordSchema = z
  .object({
    actor: actorSchema,
    created_at: timestampSchema,
    id: uuidSchema,
    outcome: controlledPackageApprovalOutcomeSchema,
    rationale: rationaleSchema,
    revoked_at: timestampSchema.nullable(),
    superseded_at: timestampSchema.nullable(),
  })
  .strict();
export const controlledPackageApprovalHistorySchema = z
  .object({ items: z.array(controlledPackageApprovalRecordSchema).max(100) })
  .strict();
export const revokeControlledPackageSchema = z
  .object({
    rationale: rationaleSchema,
    reason: controlledPackageRevocationReasonSchema,
  })
  .strict();

export const requestControlledPackageDownloadGrantSchema = z
  .object({ artifact_id: uuidSchema })
  .strict();
export const controlledPackageDownloadGrantResponseSchema = z
  .object({
    artifact_id: uuidSchema,
    download_path: z.string().regex(/^\/[^\s]{1,300}$/),
    expires_at: timestampSchema,
    grant_id: uuidSchema,
  })
  .strict();

export const controlledPackageAuditRecordSchema = z
  .object({
    actor: actorSchema.nullable(),
    created_at: timestampSchema,
    event_type: controlledPackageAuditEventTypeSchema,
    id: uuidSchema,
    request_id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    run_id: uuidSchema.nullable(),
    safe_code: safeCodeSchema.nullable(),
  })
  .strict();
export const controlledPackageAuditHistorySchema = z
  .object({
    items: z.array(controlledPackageAuditRecordSchema).max(100),
    next_cursor: uuidSchema.nullable(),
  })
  .strict();

export type StartControlledPackageRequest = z.infer<
  typeof startControlledPackageSchema
>;
export type ControlledPackageManifest = z.infer<
  typeof controlledPackageManifestSchema
>;
export type ControlledPackageErrorCode = z.infer<
  typeof controlledPackageErrorCodeSchema
>;
