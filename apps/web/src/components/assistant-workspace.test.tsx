import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/assistant-workspace.tsx"),
  "utf8",
);

describe("assistant workspace copy", () => {
  it("keeps the workspace assistant distinct from tender AI Chat without technical labels", () => {
    expect(source).toContain("Workspace Assistant");
    expect(source).toContain("How this assistant helps");
    expect(source).toContain("Tender AI Chat stays tender-specific");
    expect(source).toContain("For questions about a specific tender");
    expect(source).not.toContain("Organisation-scoped guidance");
    expect(source).not.toContain("No cross-tender evidence mode");
    expect(source).not.toContain("Deterministic workspace guidance");
  });
});
