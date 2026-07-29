import { z } from "zod";
import { ragSourceModeSchema } from "./rag.js";

export const draftTypeSchema = z.enum([
  "REQUIREMENT_RESPONSE",
  "TECHNICAL_RESPONSE",
  "ELIGIBILITY_RESPONSE",
  "COMPANY_PROFILE_RESPONSE",
  "EXPERIENCE_RESPONSE",
  "CERTIFICATION_RESPONSE",
  "OEM_AUTHORISATION_RESPONSE",
  "DELIVERY_AND_SUPPORT_RESPONSE",
  "DECLARATION_RESPONSE",
  "CLARIFICATION_AND_DEVIATION_RESPONSE",
  "CONSOLIDATED_FIRST_DRAFT",
]);

export const draftClaimClassSchema = z.enum([
  "TENDER_SOURCE_STATEMENT",
  "APPROVED_COMPANY_FACT",
  "HUMAN_AUTHORED_COMMITMENT",
  "DERIVED_ASSESSMENT_REFERENCE",
  "RISK_OR_CHECKLIST_WARNING",
  "INFERENCE_REQUIRING_REVIEW",
  "PLACEHOLDER",
]);

export const templateSectionSchema = z
  .object({
    allowed_claim_classes: z.array(draftClaimClassSchema).min(1).max(7),
    formatting_guidance: z.string().trim().max(1_000),
    heading: z.string().trim().min(1).max(240),
    key: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{1,79}$/),
    order: z.number().int().min(0).max(39),
    required_source_classes: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict()
  .refine(
    ({ formatting_guidance }) =>
      !/<script|javascript:|https?:\/\/|{{\s*include|<iframe/i.test(
        formatting_guidance,
      ),
    {
      message: "Template guidance cannot contain executable or remote content",
    },
  );

export const createDraftTemplateSchema = z
  .object({
    draft_type: draftTypeSchema,
    name: z.string().trim().min(1).max(160),
  })
  .strict();

export const createDraftTemplateVersionSchema = z
  .object({
    required_review_role: z.enum(["OWNER", "ADMIN", "REVIEWER"]),
    sections: z.array(templateSectionSchema).min(1).max(40),
  })
  .strict();

export const startDraftGenerationSchema = z
  .object({
    draft_type: draftTypeSchema,
    idempotency_key: z.string().trim().min(8).max(120),
    instructions: z.string().trim().max(2_000).optional(),
    source_mode: ragSourceModeSchema.default("TENDER_ONLY"),
    template_version_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const draftPaginationSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const draftHumanInputClassSchema = z.enum([
  "WRITING_PREFERENCE",
  "TECHNICAL_RESPONSE",
  "DELIVERY_COMMITMENT",
  "COMMERCIAL_INPUT",
  "SIGNATORY_INPUT",
  "DECLARATION_INPUT",
  "CLARIFICATION_RESPONSE",
  "OTHER",
]);

export const createDraftHumanInputSchema = z
  .object({
    input_class: draftHumanInputClassSchema,
    provenance_description: z.string().trim().min(10).max(1_000),
    section_key: z.string().trim().max(120).optional(),
    structured_requirement_id: z.string().uuid().optional(),
    value: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const reviewDraftHumanInputSchema = z
  .object({
    rationale: z.string().trim().min(10).max(2_000),
    state: z.enum(["APPROVED", "REJECTED"]),
  })
  .strict();

export const editDraftVersionSchema = z
  .object({
    change_summary: z.string().trim().min(10).max(1_000),
    sections: z
      .array(
        z
          .object({
            content: z.string().trim().max(12_000),
            section_key: z.string().trim().min(2).max(120),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();

export const draftReviewActionSchema = z
  .object({
    action: z.enum([
      "START_REVIEW",
      "COMMENT",
      "REQUEST_CHANGES",
      "ACCEPT_SECTION",
      "REJECT_SECTION",
      "APPROVE_VERSION",
      "REJECT_VERSION",
      "REOPEN_VERSION",
    ]),
    rationale: z.string().trim().min(10).max(2_000),
    section_id: z.string().uuid().optional(),
  })
  .strict();

export const resolveDraftPlaceholderSchema = z
  .object({
    evidence_citation_id: z.string().uuid().optional(),
    human_input_id: z.string().uuid().optional(),
    rationale: z.string().trim().min(10).max(2_000),
  })
  .strict()
  .refine(
    ({ evidence_citation_id, human_input_id }) =>
      evidence_citation_id !== undefined || human_input_id !== undefined,
    "A reviewed evidence citation or human input is required",
  );

export type DraftTypeRequest = z.infer<typeof draftTypeSchema>;
export type CreateDraftTemplateRequest = z.infer<
  typeof createDraftTemplateSchema
>;
export type CreateDraftTemplateVersionRequest = z.infer<
  typeof createDraftTemplateVersionSchema
>;
export type StartDraftGenerationRequest = z.infer<
  typeof startDraftGenerationSchema
>;
export type CreateDraftHumanInputRequest = z.infer<
  typeof createDraftHumanInputSchema
>;
export type ReviewDraftHumanInputRequest = z.infer<
  typeof reviewDraftHumanInputSchema
>;
export type EditDraftVersionRequest = z.infer<typeof editDraftVersionSchema>;
export type DraftReviewActionRequest = z.infer<typeof draftReviewActionSchema>;
export type ResolveDraftPlaceholderRequest = z.infer<
  typeof resolveDraftPlaceholderSchema
>;
