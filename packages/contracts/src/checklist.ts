import { z } from "zod";

const uuid = z.string().uuid();

export const checklistItemTypeSchema = z.enum([
  "OBTAIN_DOCUMENT",
  "UPLOAD_DOCUMENT",
  "RENEW_DOCUMENT",
  "VERIFY_DOCUMENT",
  "REVIEW_DOCUMENT_CONTENT",
  "CAPTURE_EVIDENCE_FACT",
  "LINK_EXISTING_EVIDENCE",
  "VERIFY_SELF_DECLARED_FACT",
  "PROVIDE_FINANCIAL_EVIDENCE",
  "PROVIDE_EXPERIENCE_EVIDENCE",
  "OBTAIN_OEM_AUTHORISATION",
  "PROVIDE_CERTIFICATION",
  "PROVIDE_LICENCE",
  "UPDATE_COMPANY_PROFILE",
  "RESOLVE_EVIDENCE_CONFLICT",
  "REVIEW_REQUIREMENT",
  "CONFIRM_APPLICABILITY",
  "SEEK_TENDER_CLARIFICATION",
  "TECHNICAL_REVIEW",
  "COMMERCIAL_REVIEW",
  "LEGAL_REVIEW",
  "READY_FOR_REASSESSMENT",
  "OTHER",
]);
export const checklistPrioritySchema = z.enum([
  "BLOCKING",
  "HIGH",
  "MEDIUM",
  "LOW",
]);
export const checklistStatusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "BLOCKED",
  "READY_FOR_REASSESSMENT",
  "RESOLVED",
  "DISMISSED",
  "SUPERSEDED",
  "INVALIDATED",
]);
export const startChecklistSchema = z
  .object({ idempotency_key: z.string().trim().min(8).max(120) })
  .strict();
export const checklistFilterSchema = z
  .object({
    assignee_id: uuid.optional(),
    assessment_state: z
      .enum([
        "VERIFIED",
        "LIKELY_MET",
        "MISSING",
        "CONFLICT",
        "NOT_APPLICABLE",
        "HUMAN_REVIEW_REQUIRED",
      ])
      .optional(),
    blocked: z.enum(["true", "false"]).optional(),
    due_after: z.coerce.date().optional(),
    due_before: z.coerce.date().optional(),
    item_type: checklistItemTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
    overdue: z.enum(["true", "false"]).optional(),
    priority: checklistPrioritySchema.optional(),
    requirement_category: z.string().trim().max(80).optional(),
    status: checklistStatusSchema.optional(),
  })
  .strict();
export const updateChecklistItemSchema = z
  .object({
    assignee_id: uuid.nullable().optional(),
    blocked_reason: z.string().trim().min(10).max(1000).optional(),
    current_description: z.string().trim().max(2000).optional(),
    current_priority: checklistPrioritySchema.optional(),
    current_title: z.string().trim().min(3).max(240).optional(),
    dismissal_rationale: z.string().trim().min(10).max(1000).optional(),
    due_date: z.coerce.date().nullable().optional(),
    rationale: z.string().trim().min(10).max(1000),
    resolution_note: z.string().trim().min(10).max(1000).optional(),
    status: checklistStatusSchema.optional(),
  })
  .strict();

export type ChecklistFilter = z.infer<typeof checklistFilterSchema>;
export type UpdateChecklistItemRequest = z.infer<
  typeof updateChecklistItemSchema
>;
