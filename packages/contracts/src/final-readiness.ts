import { z } from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const safeDisplaySchema = z.string().trim().min(1).max(240);
const rationaleSchema = z.string().trim().min(20).max(2_000);
const idempotencyKeySchema = z.string().trim().min(8).max(120);
const fingerprintTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const finalReadinessTreatmentSchema = z.enum([
  "BLOCKER",
  "HUMAN_DISPOSITION_REQUIRED",
  "WARNING",
  "INFORMATIONAL",
]);

export const finalReadinessDispositionSchema = z.enum([
  "PROCEED_TO_CONTROLLED_EXPORT_REVIEW",
  "HOLD_FOR_REMEDIATION",
  "STOP_PURSUIT",
]);

export const finalReadinessPrerequisiteReasonSchema = z.enum([
  "PREREQUISITE_MISSING",
  "PREREQUISITE_NOT_CURRENT",
  "PREREQUISITE_INVALIDATED",
  "ORGANISATION_SCOPE_MISMATCH",
  "TENDER_SCOPE_MISMATCH",
  "TENDER_VERSION_SCOPE_MISMATCH",
  "SOURCE_SET_NOT_SNAPSHOTTABLE",
  "EARLY_RISK_NOT_COMPLETE",
  "CONTINUE_DECISION_NOT_CURRENT",
  "ELIGIBILITY_ASSESSMENT_NOT_COMPLETE",
  "EVIDENCE_SNAPSHOT_NOT_EXACT",
  "CHECKLIST_GENERATION_NOT_COMPLETE",
  "CONSOLIDATED_DRAFT_COUNT_INVALID",
  "CONSOLIDATED_DRAFT_NOT_QUALIFIED",
]);

export const consolidatedDraftQualificationReasonSchema = z.enum([
  "REQUIRED_DRAFT_TYPE_MISMATCH",
  "CURRENT_VERSION_REQUIRED",
  "APPROVED_VERSION_REQUIRED",
  "NON_INVALIDATED_VERSION_REQUIRED",
  "NON_SUPERSEDED_VERSION_REQUIRED",
  "CURRENT_SOURCE_FINGERPRINT_REQUIRED",
  "INDEPENDENT_APPROVER_REQUIRED",
  "APPROVER_ROLE_EVIDENCE_REQUIRED",
  "REQUIRED_REVIEWER_ROLE_NOT_SATISFIED",
  "UNRESOLVED_APPROVAL_BLOCKING_PLACEHOLDER",
  "UNSUPPORTED_MATERIAL_CLAIM",
  "CONFLICTING_MATERIAL_CLAIM",
  "EXPIRED_MATERIAL_CLAIM",
  "MATERIAL_CLAIM_REQUIRES_HUMAN_REVIEW",
  "UNVALIDATED_HUMAN_EDITED_SECTION",
  "UNREVIEWED_MATERIAL_COMMITMENT",
]);

export const finalReadinessDispositionDenialSchema = z.enum([
  "READINESS_RUN_NOT_CURRENT",
  "READINESS_RUN_NOT_COMPLETE",
  "FINAL_RISK_RUN_NOT_CURRENT",
  "FINAL_RISK_RUN_NOT_COMPLETE",
  "READINESS_RUN_INVALIDATED",
  "INPUT_FINGERPRINT_STALE",
  "FINAL_READINESS_DECISION_PERMISSION_REQUIRED",
  "REQUESTER_CANNOT_DECIDE",
  "CONSOLIDATED_DRAFT_CREATOR_CANNOT_DECIDE",
  "DECISION_RATIONALE_REQUIRED",
  "UNRESOLVED_BLOCKERS",
  "UNRESOLVED_HUMAN_DISPOSITIONS",
  "REQUIRED_ACKNOWLEDGEMENTS_MISSING",
  "MATERIAL_FINDING_PROVENANCE_INVALID",
]);

export const finalReadinessPolicyVersionSchema = z.literal(
  "final-readiness-deterministic-v1",
);

export const finalReadinessPrerequisiteSchema = z.enum([
  "TENDER",
  "TENDER_VERSION",
  "SOURCE_SET",
  "EXTRACTION",
  "EARLY_RISK",
  "CONTINUE_DECISION",
  "ELIGIBILITY_ASSESSMENT",
  "EVIDENCE_SNAPSHOT",
  "CHECKLIST_GENERATION",
  "CONSOLIDATED_DRAFT",
]);

const prerequisiteDenialSchema = z
  .object({
    code: finalReadinessPrerequisiteReasonSchema,
    prerequisite: finalReadinessPrerequisiteSchema,
  })
  .strict();

export const finalReadinessPreflightResponseSchema = z
  .object({
    eligible_independent_decision_actor_exists: z.boolean(),
    evaluated_at: timestampSchema,
    hard_prerequisites_pass: z.boolean(),
    informational_only: z.literal(true),
    policy_version: finalReadinessPolicyVersionSchema,
    prerequisite_denials: z.array(prerequisiteDenialSchema).max(50),
    qualifying_consolidated_draft_version_id: uuidSchema.nullable(),
    tender_version_id: uuidSchema,
    transactional_revalidation_required: z.literal(true),
  })
  .strict();

export const startFinalReadinessSchema = z
  .object({ idempotency_key: idempotencyKeySchema })
  .strict();

export const finalReadinessRunStatusSchema = z.enum([
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const finalReadinessProgressStageSchema = z.enum([
  "QUEUED",
  "VALIDATING_SNAPSHOT",
  "EVALUATING_FINAL_RISK",
  "EVALUATING_READINESS",
  "PERSISTING_FINDINGS",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
]);

export const finalReadinessProgressEventSchema = z
  .object({
    occurred_at: timestampSchema,
    progress_percent: z.number().int().min(0).max(100),
    run_id: uuidSchema,
    stage: finalReadinessProgressStageSchema,
    status: finalReadinessRunStatusSchema,
  })
  .strict();

const findingCountsSchema = z
  .object({
    blockers: z.number().int().nonnegative(),
    human_disposition_required: z.number().int().nonnegative(),
    informational: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  })
  .strict();

const actorDisplaySchema = z
  .object({ display_name: safeDisplaySchema, user_id: uuidSchema })
  .strict();

export const finalReadinessDispositionRecordSchema = z
  .object({
    actor: actorDisplaySchema,
    created_at: timestampSchema,
    disposition: finalReadinessDispositionSchema,
    id: uuidSchema,
    rationale: rationaleSchema,
    run_id: uuidSchema,
    superseded: z.boolean(),
    superseded_at: timestampSchema.nullable(),
  })
  .strict();

export const finalReadinessRunSchema = z
  .object({
    completed_at: timestampSchema.nullable(),
    created_at: timestampSchema,
    current_disposition: finalReadinessDispositionRecordSchema.nullable(),
    disposition_concurrency_token: fingerprintTokenSchema,
    failure_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .nullable(),
    final_risk_run_id: uuidSchema,
    final_risk_status: finalReadinessRunStatusSchema,
    finding_counts: findingCountsSchema,
    id: uuidSchema,
    invalidated: z.boolean(),
    is_current: z.boolean(),
    policy_version: finalReadinessPolicyVersionSchema,
    stale: z.boolean(),
    started_at: timestampSchema.nullable(),
    status: finalReadinessRunStatusSchema,
    tender_version_id: uuidSchema,
    updated_at: timestampSchema,
  })
  .strict();

export const startFinalReadinessResponseSchema = z
  .object({
    created_at: timestampSchema,
    events_path: z.string().regex(/^\/[^\s]{1,300}$/),
    final_risk_run_id: uuidSchema,
    policy_version: finalReadinessPolicyVersionSchema,
    polling_path: z.string().regex(/^\/[^\s]{1,300}$/),
    run_id: uuidSchema,
    status: finalReadinessRunStatusSchema,
  })
  .strict();

export const finalReadinessCurrentResponseSchema = z
  .object({ run: finalReadinessRunSchema.nullable() })
  .strict();

export const finalReadinessPaginationSchema = z
  .object({
    cursor: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const finalReadinessHistoryResponseSchema = z
  .object({
    items: z.array(finalReadinessRunSchema).max(100),
    next_cursor: uuidSchema.nullable(),
  })
  .strict();

export const finalReadinessFindingLifecycleSchema = z.enum([
  "OPEN",
  "UNDER_REVIEW",
  "DISPOSITION_RECORDED",
  "RESOLVED",
  "SUPERSEDED",
  "INVALIDATED",
]);

export const finalReadinessFindingReviewStateSchema = z.enum([
  "UNREVIEWED",
  "HUMAN_REVIEW_REQUIRED",
  "REVIEWED",
]);

export const finalReadinessMaterialitySchema = z.enum([
  "NON_MATERIAL",
  "MATERIAL",
  "POTENTIALLY_BLOCKING",
]);

function sourceHandle<T extends string>(
  sourceClass: T,
): z.ZodObject<{ id: typeof uuidSchema; source_class: z.ZodLiteral<T> }> {
  return z
    .object({ id: uuidSchema, source_class: z.literal(sourceClass) })
    .strict();
}

export const finalReadinessProvenanceHandleSchema = z.discriminatedUnion(
  "source_class",
  [
    sourceHandle("EXTRACTION_CITATION"),
    sourceHandle("RISK_FINDING"),
    sourceHandle("ELIGIBILITY_ASSESSMENT"),
    sourceHandle("EVIDENCE_FACT_VERSION"),
    sourceHandle("EVIDENCE_CITATION"),
    sourceHandle("CHECKLIST_ITEM"),
    sourceHandle("DRAFT_VERSION"),
    sourceHandle("DRAFT_CLAIM"),
    sourceHandle("DRAFT_CITATION"),
    sourceHandle("DRAFT_PLACEHOLDER"),
    sourceHandle("HUMAN_REVIEW_RECORD"),
  ],
);

const reviewSummarySchema = z
  .object({
    acknowledgement_recorded: z.boolean(),
    latest_action: z
      .enum(["ACKNOWLEDGE", "ACCEPT", "REMEDIATE", "DISMISS", "REOPEN"])
      .nullable(),
    reviewed_at: timestampSchema.nullable(),
    reviewer: actorDisplaySchema.nullable(),
  })
  .strict();

export const finalReadinessFindingSchema = z
  .object({
    created_at: timestampSchema,
    current_review_version: z.number().int().nonnegative(),
    explanation: z.string().trim().min(1).max(2_000),
    id: uuidSchema,
    lifecycle_state: finalReadinessFindingLifecycleSchema,
    materiality: finalReadinessMaterialitySchema.nullable(),
    provenance: z.array(finalReadinessProvenanceHandleSchema).max(50),
    provenance_valid: z.boolean(),
    review_state: finalReadinessFindingReviewStateSchema,
    review_summary: reviewSummarySchema,
    rule_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(120),
    title: safeDisplaySchema,
    treatment: finalReadinessTreatmentSchema,
  })
  .strict();

export const finalReadinessFindingFilterSchema = z
  .object({
    cursor: uuidSchema.optional(),
    lifecycle_state: finalReadinessFindingLifecycleSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    materiality: finalReadinessMaterialitySchema.optional(),
    review_state: finalReadinessFindingReviewStateSchema.optional(),
    rule_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .max(120)
      .optional(),
    treatment: finalReadinessTreatmentSchema.optional(),
  })
  .strict();

export const finalReadinessFindingListResponseSchema = z
  .object({
    items: z.array(finalReadinessFindingSchema).max(100),
    next_cursor: uuidSchema.nullable(),
  })
  .strict();

export const finalReadinessFindingReviewActionSchema = z.enum([
  "ACKNOWLEDGE",
  "ACCEPT",
  "REMEDIATE",
  "DISMISS",
  "REOPEN",
]);

export const reviewFinalReadinessFindingSchema = z
  .object({
    acknowledgement_recorded: z.boolean(),
    action: finalReadinessFindingReviewActionSchema,
    expected_current_review_version: z.number().int().nonnegative(),
    rationale: rationaleSchema,
  })
  .strict();

export const finalReadinessFindingReviewRecordSchema = z
  .object({
    acknowledgement_recorded: z.boolean(),
    action: finalReadinessFindingReviewActionSchema,
    actor: actorDisplaySchema,
    created_at: timestampSchema,
    finding_id: uuidSchema,
    id: uuidSchema,
    rationale: rationaleSchema,
    review_version: z.number().int().positive(),
  })
  .strict();

export const finalReadinessFindingReviewHistorySchema = z
  .object({ items: z.array(finalReadinessFindingReviewRecordSchema).max(100) })
  .strict();

export const createFinalReadinessDispositionSchema = z
  .object({
    acknowledgement_ids: z
      .array(uuidSchema)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Acknowledgement identifiers must be unique",
      ),
    disposition: finalReadinessDispositionSchema,
    expected_fingerprint: fingerprintTokenSchema,
    rationale: rationaleSchema,
    run_id: uuidSchema,
  })
  .strict();

export const finalReadinessDispositionHistorySchema = z
  .object({ items: z.array(finalReadinessDispositionRecordSchema).max(100) })
  .strict();

export const cancelFinalReadinessSchema = z
  .object({ rationale: rationaleSchema, run_id: uuidSchema })
  .strict();

export const retryFinalReadinessSchema = z
  .object({ idempotency_key: idempotencyKeySchema, run_id: uuidSchema })
  .strict();

export const finalReadinessErrorCodes = [
  "FINAL_READINESS_PREREQUISITES_NOT_CURRENT",
  "FINAL_READINESS_ALREADY_ACTIVE",
  "FINAL_READINESS_RUN_STALE",
  "FINAL_READINESS_RUN_INVALIDATED",
  "FINAL_READINESS_RUN_NOT_COMPLETE",
  "FINAL_READINESS_FINAL_RISK_NOT_COMPLETE",
  "FINAL_READINESS_DECISION_BLOCKED",
  "FINAL_READINESS_SEPARATION_OF_DUTIES_REQUIRED",
  "FINAL_READINESS_SOURCE_INVALID",
  "FINAL_READINESS_RUN_NOT_RETRYABLE",
  "FINAL_READINESS_IDEMPOTENCY_CONFLICT",
] as const;
export const finalReadinessErrorCodeSchema = z.enum(finalReadinessErrorCodes);

export type FinalReadinessPreflightResponse = z.infer<
  typeof finalReadinessPreflightResponseSchema
>;
export type StartFinalReadinessRequest = z.infer<
  typeof startFinalReadinessSchema
>;
export type StartFinalReadinessResponse = z.infer<
  typeof startFinalReadinessResponseSchema
>;
export type FinalReadinessRun = z.infer<typeof finalReadinessRunSchema>;
export type FinalReadinessProgressEvent = z.infer<
  typeof finalReadinessProgressEventSchema
>;
export type FinalReadinessPagination = z.infer<
  typeof finalReadinessPaginationSchema
>;
export type FinalReadinessFinding = z.infer<typeof finalReadinessFindingSchema>;
export type FinalReadinessFindingFilter = z.infer<
  typeof finalReadinessFindingFilterSchema
>;
export type ReviewFinalReadinessFindingRequest = z.infer<
  typeof reviewFinalReadinessFindingSchema
>;
export type CreateFinalReadinessDispositionRequest = z.infer<
  typeof createFinalReadinessDispositionSchema
>;
export type CancelFinalReadinessRequest = z.infer<
  typeof cancelFinalReadinessSchema
>;
export type RetryFinalReadinessRequest = z.infer<
  typeof retryFinalReadinessSchema
>;
export type FinalReadinessErrorCode = z.infer<
  typeof finalReadinessErrorCodeSchema
>;
