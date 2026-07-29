import { describe, expect, it } from "vitest";
import {
  pursuitDecisionSchema,
  riskFindingFilterSchema,
  riskReviewSchema,
} from "./risk-analysis.js";

describe("risk-analysis contracts", () => {
  it("requires an explicit decision, rationale, and limitations acknowledgement", () => {
    expect(() =>
      pursuitDecisionSchema.parse({
        acknowledged_limitations: false,
        decision: "CONTINUE",
        rationale: "short",
      }),
    ).toThrow();
    expect(
      pursuitDecisionSchema.parse({
        acknowledged_limitations: true,
        decision: "HOLD",
        rationale: "Review the cited commercial terms before proceeding.",
      }).decision,
    ).toBe("HOLD");
  });

  it("requires a severity for severity changes", () => {
    expect(() =>
      riskReviewSchema.parse({
        action: "CHANGE_SEVERITY",
        rationale: "The cited amount changes the material commercial exposure.",
      }),
    ).toThrow();
  });

  it("bounds finding pagination", () => {
    expect(() => riskFindingFilterSchema.parse({ limit: 101 })).toThrow();
  });
});
