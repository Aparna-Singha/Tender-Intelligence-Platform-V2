import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/rag-chatbot.tsx"),
  "utf8",
);

describe("RAG chatbot workspace", () => {
  it("shows source limits, human control, and no submission action", () => {
    const normalizedSource = source.replace(/\s+/g, " ");

    expect(normalizedSource).toContain(
      "Answers remain grounded in authorised tender and company evidence",
    );
    expect(normalizedSource).toContain(
      "No legal advice or autonomous bid decisions are made here.",
    );
    expect(normalizedSource).toContain(
      "No answer could be grounded for this question.",
    );
    expect(normalizedSource).toContain("Human review required");
    expect(normalizedSource).not.toContain("Submit bid");
  });
});
