import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./rag-chatbot.tsx", import.meta.url),
  "utf8",
);

describe("RAG chatbot workspace", () => {
  it("shows source limits, human control, and no submission action", () => {
    expect(source).toContain(
      "Answers are limited to authorised tender and evidence sources.",
    );
    expect(source).toContain("does not provide legal advice");
    expect(source).toContain("human-controlled");
    expect(source).not.toContain("Submit bid");
  });
});
