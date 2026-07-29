import { z } from "zod";

export const ragSourceModeSchema = z.enum([
  "TENDER_ONLY",
  "TENDER_AND_APPROVED_COMPANY_EVIDENCE",
  "TENDER_AND_DERIVED_WORKFLOW_RECORDS",
  "FULL_AUTHORISED_TENDER_CONTEXT",
]);

export const startRagIndexSchema = z
  .object({
    idempotency_key: z.string().trim().min(8).max(120),
    source_mode: ragSourceModeSchema.default("TENDER_ONLY"),
  })
  .strict();

export const createRagConversationSchema = z
  .object({
    source_mode: ragSourceModeSchema.default("TENDER_ONLY"),
    title: z.string().trim().min(1).max(160),
  })
  .strict();

export const askRagQuestionSchema = z
  .object({
    idempotency_key: z.string().trim().min(8).max(120),
    question: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const ragPaginationSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const ragFeedbackSchema = z
  .object({
    comment: z.string().trim().max(500).optional(),
    rating: z.enum(["HELPFUL", "NOT_HELPFUL"]),
    reason_code: z.string().trim().max(80).optional(),
  })
  .strict();

export type RagSourceMode = z.infer<typeof ragSourceModeSchema>;
export type StartRagIndexRequest = z.infer<typeof startRagIndexSchema>;
export type CreateRagConversationRequest = z.infer<
  typeof createRagConversationSchema
>;
export type AskRagQuestionRequest = z.infer<typeof askRagQuestionSchema>;
export type RagFeedbackRequest = z.infer<typeof ragFeedbackSchema>;
