import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/rag-processor.ts"),
  "utf8",
);

describe("RAG retrieval security construction", () => {
  it("places hard scope predicates inside the authorised CTE before ranking", () => {
    const authorised = source.indexOf("WITH authorised AS");
    const organisation = source.indexOf('"organisation_id" =', authorised);
    const tender = source.indexOf('"tender_id" =', authorised);
    const version = source.indexOf('"tender_version_id" =', authorised);
    const index = source.indexOf('"index_run_id" =', authorised);
    const sourceClass = source.indexOf('"source_class"::text IN', authorised);
    const ranked = source.indexOf("ranked AS", authorised);
    expect(authorised).toBeGreaterThan(0);
    for (const predicate of [
      organisation,
      tender,
      version,
      index,
      sourceClass,
    ]) {
      expect(predicate).toBeGreaterThan(authorised);
      expect(predicate).toBeLessThan(ranked);
    }
  });

  it("does not expose tools or public internet retrieval", () => {
    expect(source).not.toContain("webSearch");
    expect(source).not.toContain("toolDeclarations");
    expect(source).not.toContain("approvedObjectKey");
  });
});
