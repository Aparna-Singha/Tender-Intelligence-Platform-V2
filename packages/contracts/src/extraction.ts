import { z } from "zod";

export const extractionRunStatuses = [
  "QUEUED",
  "PARSING",
  "STRUCTURING",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
  "INVALIDATED",
] as const;
export const extractionConfidences = [
  "HIGH",
  "MEDIUM",
  "LOW",
  "HUMAN_REVIEW_REQUIRED",
] as const;
export const extractionReviewStates = [
  "UNREVIEWED",
  "ACCEPTED",
  "REJECTED",
  "CORRECTED",
  "HUMAN_REVIEW_REQUIRED",
] as const;

export const startExtractionSchema = z.object({
  idempotency_key: z.string().trim().min(8).max(120),
});

export const extractionPaginationSchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const requirementFilterSchema = extractionPaginationSchema.extend({
  category: z.string().trim().max(80).optional(),
  confidence: z.enum(extractionConfidences).optional(),
  obligation: z
    .enum(["MANDATORY", "OPTIONAL", "CONDITIONAL", "UNSPECIFIED"])
    .optional(),
  review_state: z.enum(extractionReviewStates).optional(),
  search: z.string().trim().max(120).optional(),
});

export const reviewExtractionSchema = z
  .object({
    action: z.enum([
      "ACCEPT",
      "REJECT",
      "CORRECT",
      "MARK_AMBIGUOUS",
      "REQUEST_REVIEW",
      "RESOLVE_CONFLICT",
    ]),
    corrected_value: z.string().trim().max(4000).optional(),
    reason: z.string().trim().min(3).max(1000),
  })
  .superRefine((value, context) => {
    if (
      ["CORRECT", "RESOLVE_CONFLICT"].includes(value.action) &&
      value.corrected_value === undefined
    )
      context.addIssue({
        code: "custom",
        message: "A corrected value is required for this action",
        path: ["corrected_value"],
      });
  });

export type StartExtractionRequest = z.infer<typeof startExtractionSchema>;
export type ExtractionPagination = z.infer<typeof extractionPaginationSchema>;
export type RequirementFilter = z.infer<typeof requirementFilterSchema>;
export type ReviewExtractionRequest = z.infer<typeof reviewExtractionSchema>;
