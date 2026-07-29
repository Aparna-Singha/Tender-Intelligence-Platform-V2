import { z } from "zod";

export const startRiskAnalysisSchema = z
  .object({ idempotency_key: z.string().trim().min(8).max(120) })
  .strict();

export const riskFindingFilterSchema = z
  .object({
    blocking: z.enum(["true", "false"]).optional(),
    category: z.string().trim().max(80).optional(),
    confidence: z
      .enum(["HIGH", "MEDIUM", "LOW", "HUMAN_REVIEW_REQUIRED"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    materiality: z
      .enum([
        "NON_MATERIAL",
        "MATERIAL",
        "POTENTIALLY_BLOCKING",
        "BLOCKING_REQUIRES_HUMAN_DISPOSITION",
      ])
      .optional(),
    offset: z.coerce.number().int().min(0).default(0),
    review_state: z
      .enum(["UNREVIEWED", "HUMAN_REVIEW_REQUIRED", "REVIEWED"])
      .optional(),
    severity: z
      .enum(["INFORMATIONAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
      .optional(),
    status: z
      .enum([
        "OPEN",
        "UNDER_REVIEW",
        "ACKNOWLEDGED",
        "MITIGATED",
        "ACCEPTED_RISK",
        "DISMISSED",
        "RESOLVED",
        "SUPERSEDED",
        "INVALIDATED",
      ])
      .optional(),
  })
  .strict();

export const riskReviewSchema = z
  .object({
    action: z.enum([
      "ACKNOWLEDGE",
      "REQUEST_REVIEW",
      "CONFIRM",
      "DISMISS",
      "CHANGE_SEVERITY",
      "MARK_MITIGATED",
      "ACCEPT_RISK",
      "RESOLVE",
      "REOPEN",
    ]),
    rationale: z.string().trim().min(10).max(1000),
    severity: z
      .enum(["INFORMATIONAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.action === "CHANGE_SEVERITY" && input.severity === undefined)
      context.addIssue({
        code: "custom",
        message: "severity is required",
        path: ["severity"],
      });
  });

export const pursuitDecisionSchema = z
  .object({
    acknowledged_limitations: z.literal(true),
    decision: z.enum(["CONTINUE", "HOLD", "STOP"]),
    rationale: z.string().trim().min(20).max(2000),
  })
  .strict();

export type RiskFindingFilter = z.infer<typeof riskFindingFilterSchema>;
export type RiskReviewRequest = z.infer<typeof riskReviewSchema>;
export type PursuitDecisionRequest = z.infer<typeof pursuitDecisionSchema>;
