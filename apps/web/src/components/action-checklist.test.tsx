import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/action-checklist.tsx"),
  "utf8",
);

describe("Phase 8 checklist workspace", () => {
  it("uses required human-control and no-score language", () => {
    expect(source).toContain(
      "Uploading a document does not automatically prove",
    );
    expect(source).toContain("Eligibility decisions remain human-controlled");
    expect(source).toContain("Checklist workflow progress");
    expect(source).not.toContain("bid readiness score");
    expect(source).not.toContain("probability of success");
  });
});
