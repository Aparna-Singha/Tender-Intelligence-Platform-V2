import { describe, expect, it } from "vitest";
import {
  checklistFilterSchema,
  updateChecklistItemSchema,
} from "./checklist.js";

describe("checklist contracts", () => {
  it("rejects unknown filters and oversized pages", () => {
    expect(() => checklistFilterSchema.parse({ unknown: "x" })).toThrow();
    expect(() => checklistFilterSchema.parse({ limit: 101 })).toThrow();
  });

  it("requires a bounded rationale for human workflow changes", () => {
    expect(() =>
      updateChecklistItemSchema.parse({
        rationale: "short",
        status: "DISMISSED",
      }),
    ).toThrow();
    expect(
      updateChecklistItemSchema.parse({
        dismissal_rationale: "No longer pursued by the authorised tender team.",
        rationale: "No longer pursued by the authorised tender team.",
        status: "DISMISSED",
      }).status,
    ).toBe("DISMISSED");
  });
});
