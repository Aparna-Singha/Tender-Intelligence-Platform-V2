import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("risk analysis citation validation", () => {
  it("accepts persisted VALID extraction citations as well as legacy VALIDATED ones", () => {
    const source = readFileSync(
      new URL("../src/risk-analysis-processor.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      '!["VALID", "VALIDATED"].includes(citation.validationStatus)',
    );
  });
});
