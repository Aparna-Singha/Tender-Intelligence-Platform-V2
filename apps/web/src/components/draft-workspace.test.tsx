import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/draft-workspace.tsx"),
  "utf8",
);

describe("draft workspace safety", () => {
  it("shows human-control and source limitations", () => {
    expect(source).toContain("AI-assisted first draft");
    expect(source).toContain("Human review is mandatory");
    expect(source).toContain("does not determine legal compliance");
  });

  it("shows citations, placeholders, version history, and review controls", () => {
    expect(source).toContain("Version history");
    expect(source).toContain("Placeholders");
    expect(source).toContain("Request changes");
    expect(source).toContain("Approve for final readiness review");
    expect(source).toContain("citation");
  });

  it("does not expose readiness, export, scraping, or submission actions", () => {
    expect(source).not.toContain("Run final readiness");
    expect(source).not.toContain("Export package");
    expect(source).not.toContain("Scrape");
    expect(source).not.toContain("Submit bid");
  });
});
