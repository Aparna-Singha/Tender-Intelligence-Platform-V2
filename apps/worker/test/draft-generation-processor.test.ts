import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDraftGenerationJob } from "../src/draft-generation-processor.js";

const source = readFileSync(
  new URL("../src/draft-generation-processor.ts", import.meta.url),
  "utf8",
);

describe("fact-constrained draft worker", () => {
  it("accepts only opaque tenant-scoped job payloads", () => {
    expect(
      isDraftGenerationJob({
        draftGenerationRunId: "run",
        kind: "DRAFT_GENERATION",
        organisationId: "organisation",
        requestId: "request",
      }),
    ).toBe(true);
    expect(
      isDraftGenerationJob({
        kind: "DRAFT_GENERATION",
        organisationId: "organisation",
        requestId: "request",
        tenderId: "browser-selected",
      }),
    ).toBe(false);
  });

  it("rechecks every authoritative prerequisite including CONTINUE", () => {
    expect(source).toContain("assertCurrentAuthority");
    expect(source).toContain('decision: "CONTINUE"');
    expect(source).toContain("supersededAt: null");
    expect(source).toContain("activeEarlyRiskRun");
    expect(source).toContain("activeEligibilityAssessmentRun");
    expect(source).toContain("activeExtractionRun");
  });

  it("hard-bounds retrieval to the snapshotted tenant and source records", () => {
    expect(source).toContain('"organisation_id" = ${run.organisationId}::uuid');
    expect(source).toContain('"tender_id" = ${run.tenderId}::uuid');
    expect(source).toContain('"index_run_id" = ${run.ragIndexRunId}::uuid');
    expect(source).toContain("snapshottedChunkIds.map");
    expect(source).toContain("Prisma.sql`${id}::uuid`");
    expect(source).toContain("DRAFT_MAX_CONTEXTS_PER_SECTION");
  });

  it("does not consume chat answers as drafting authority", () => {
    expect(source).not.toContain("ragAnswer");
    expect(source).not.toContain("ragMessage");
    expect(source).not.toContain("conversation");
  });

  it("fails before marking output complete when citations or company facts are invalid", () => {
    expect(source).toContain("DRAFT_CITATION_INVALID");
    expect(source).toContain("COMPANY_FACT_SOURCE_INVALID");
    expect(source.indexOf("verifyCitationHandles")).toBeLessThan(
      source.indexOf('status: "COMPLETE"'),
    );
    expect(source).toContain("evidenceFactVersionId");
  });
});
