import { describe, expect, it } from "vitest";
import { askRagQuestionSchema, createRagConversationSchema } from "./rag.js";

describe("RAG contracts", () => {
  it("defaults conversations to tender-only evidence", () => {
    expect(
      createRagConversationSchema.parse({ title: "Eligibility questions" })
        .source_mode,
    ).toBe("TENDER_ONLY");
  });

  it("rejects oversized questions and authoritative IDs", () => {
    expect(() =>
      askRagQuestionSchema.parse({
        idempotency_key: "aaaaaaaa",
        organisation_id: crypto.randomUUID(),
        question: "Valid?",
      }),
    ).toThrow();
    expect(() =>
      askRagQuestionSchema.parse({
        idempotency_key: "aaaaaaaa",
        question: "x".repeat(2_001),
      }),
    ).toThrow();
  });
});
