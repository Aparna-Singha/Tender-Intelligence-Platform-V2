import { z } from "zod";

const uuid = z.string().uuid();
export const eligibilityStateSchema = z.enum([
  "VERIFIED",
  "LIKELY_MET",
  "MISSING",
  "CONFLICT",
  "NOT_APPLICABLE",
  "HUMAN_REVIEW_REQUIRED",
]);
export const evidenceValueTypeSchema = z.enum([
  "TEXT",
  "NUMBER",
  "BOOLEAN",
  "DATE",
  "MONEY",
  "DURATION",
  "TEXT_LIST",
  "IDENTIFIER",
  "DOCUMENT_EXISTENCE",
]);

export const startEligibilityAssessmentSchema = z
  .object({ idempotency_key: z.string().trim().min(8).max(120) })
  .strict();

export const evidenceFactValueSchema = z
  .object({
    boolean_value: z.boolean().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/u)
      .optional(),
    date_value: z.coerce.date().optional(),
    financial_year: z
      .string()
      .regex(/^\d{4}-\d{2}$/u)
      .optional(),
    number_value: z.number().finite().optional(),
    text_list_value: z
      .array(z.string().trim().min(1).max(200))
      .max(50)
      .optional(),
    text_value: z.string().trim().min(1).max(1000).optional(),
    unit: z.string().trim().min(1).max(40).optional(),
    value_type: evidenceValueTypeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    const populated = [
      input.boolean_value,
      input.date_value,
      input.number_value,
      input.text_value,
      input.text_list_value,
    ].filter((value) => value !== undefined);
    if (populated.length !== 1)
      context.addIssue({
        code: "custom",
        message: "Exactly one typed value is required",
      });
  });

export const createEvidenceFactSchema = z
  .object({
    document_id: uuid,
    document_version_id: uuid,
    fact_type: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{1,79}$/u),
    issuing_authority: z.string().trim().max(240).optional(),
    scope: z.string().trim().max(1000).optional(),
    valid_from: z.coerce.date().optional(),
    valid_until: z.coerce.date().optional(),
    value: evidenceFactValueSchema,
  })
  .strict();

export const createEvidenceFactVersionSchema = createEvidenceFactSchema.omit({
  document_id: true,
  document_version_id: true,
});

export const createCompanyCitationSchema = z
  .object({
    bounded_excerpt: z.string().trim().min(1).max(1000),
    cell_range: z.string().trim().max(80).optional(),
    document_id: uuid,
    document_version_id: uuid,
    page_number: z.number().int().positive().max(100_000).optional(),
    section_label: z.string().trim().max(160).optional(),
    sheet_name: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.sheet_name === undefined) !== (input.cell_range === undefined))
      context.addIssue({
        code: "custom",
        message: "sheet_name and cell_range must be supplied together",
      });
  });

export const evidenceFactReviewSchema = z
  .object({
    action: z.enum(["ACCEPT", "REJECT", "REQUEST_HUMAN_REVIEW", "INVALIDATE"]),
    rationale: z.string().trim().min(10).max(1000),
  })
  .strict();

export const assessmentReviewSchema = z
  .object({
    action: z.enum([
      "ACCEPT_PROPOSAL",
      "MARK_VERIFIED",
      "MARK_LIKELY_MET",
      "MARK_MISSING",
      "MARK_CONFLICT",
      "MARK_NOT_APPLICABLE",
      "REQUEST_HUMAN_REVIEW",
      "RESOLVE_CONFLICT",
      "REOPEN",
    ]),
    chosen_state: eligibilityStateSchema.optional(),
    rationale: z.string().trim().min(10).max(2000),
  })
  .strict();

export const assessmentFilterSchema = z
  .object({
    category: z.string().trim().max(80).optional(),
    conflict: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    obligation: z
      .enum(["MANDATORY", "OPTIONAL", "CONDITIONAL", "UNSPECIFIED"])
      .optional(),
    offset: z.coerce.number().int().min(0).default(0),
    proposed_state: eligibilityStateSchema.optional(),
    review_state: z
      .enum(["UNREVIEWED", "HUMAN_REVIEW_REQUIRED", "REVIEWED", "FINALISED"])
      .optional(),
    state: eligibilityStateSchema.optional(),
  })
  .strict();

export const linkAssessmentEvidenceSchema = z
  .object({
    evidence_fact_version_id: uuid,
    link_type: z.enum([
      "DIRECT_SUPPORT",
      "PARTIAL_SUPPORT",
      "CONTRADICTS",
      "CONTEXT_ONLY",
      "SELF_DECLARED_SUPPORT",
    ]),
    scope: z.string().trim().max(1000).optional(),
  })
  .strict();

export type AssessmentFilter = z.infer<typeof assessmentFilterSchema>;
export type AssessmentReviewRequest = z.infer<typeof assessmentReviewSchema>;
export type CreateCompanyCitationRequest = z.infer<
  typeof createCompanyCitationSchema
>;
export type CreateEvidenceFactRequest = z.infer<
  typeof createEvidenceFactSchema
>;
export type EvidenceFactReviewRequest = z.infer<
  typeof evidenceFactReviewSchema
>;
export type LinkAssessmentEvidenceRequest = z.infer<
  typeof linkAssessmentEvidenceSchema
>;
