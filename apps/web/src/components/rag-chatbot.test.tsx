import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RagChatbot } from "./rag-chatbot";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

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

  it("does not crash when a conversation detail arrives without citation arrays", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) {
        return [
          {
            id: "conversation-1",
            sourceMode: "TENDER_ONLY",
            title: "Existing tender chat",
            updatedAt: "2026-08-24T09:00:00.000Z",
          },
        ];
      }
      if (path.endsWith("/rag-conversations/conversation-1")) {
        return {
          answerRuns: [
            {
              id: "answer-1",
              status: "COMPLETED",
            },
          ],
          id: "conversation-1",
          messages: [
            {
              content: "Summarise the current blockers.",
              id: "message-1",
              role: "ASSISTANT",
            },
          ],
          sourceMode: "TENDER_ONLY",
          title: "Existing tender chat",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RagChatbot
        organisationId="org-1"
        tenderId="tender-1"
        tenderTitle="Office equipment tender"
        versionId="version-1"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Existing tender chat" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Summarise the current blockers."),
    ).toBeInTheDocument();
  });
});
