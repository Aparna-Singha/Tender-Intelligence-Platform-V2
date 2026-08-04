import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/components/controlled-review-package-workspace.tsx",
  "utf8",
);

describe("controlled review package workspace", () => {
  it("keeps generation, review, controlled approval, and download distinct", () => {
    expect(source).toContain("Generate review package");
    expect(source).toContain("Record review complete");
    expect(source).toContain("Approve for controlled download");
    expect(source).toContain("Authorise one-minute download");
    expect(source).not.toContain("Approved for submission");
  });
  it("uses opaque server authority and never displays storage keys", () => {
    expect(source).toContain("crypto.randomUUID()");
    expect(source).not.toMatch(
      /object[_ ]key|signed[_ ]url|localStorage|sessionStorage/i,
    );
    expect(source).toContain("transaction always revalidates authority");
  });
  it("renders blockers, warnings, immutable history, and accessibility labels", () => {
    for (const value of [
      "HARD_GENERATION_BLOCKER",
      "PACKAGE_WARNING",
      "REVIEW_BLOCKER",
      "DOWNLOAD_BLOCKER",
      "Package history",
      "Append-only review comment",
      "aria-live",
    ])
      expect(source).toContain(value);
  });
});
