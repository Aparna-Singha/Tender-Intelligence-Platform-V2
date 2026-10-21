import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveConversationTitle, RagChatbot } from "./rag-chatbot";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock("../lib/api", () => ({
  apiRequest,
  PublicApiError: class PublicApiError extends Error {},
  formatApiError: (_error: unknown, fallback: string) => fallback,
}));

const source = readFileSync(
  resolve(process.cwd(), "src/components/rag-chatbot.tsx"),
  "utf8",
);

describe("RAG chatbot workspace", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("shows source limits, human control, and no submission action", () => {
    const normalizedSource = source.replace(/\s+/g, " ");

    expect(normalizedSource).toContain(
      "Answers remain grounded in authorised tender and company evidence",
    );
    expect(normalizedSource).toContain(
      "No legal advice or autonomous bid decisions are made here.",
    );
    expect(normalizedSource).toContain(
      "I couldn’t find enough authorised evidence",
    );
    expect(normalizedSource).toContain("Try a broader wording");
    expect(normalizedSource).not.toContain("Submit bid");
  });

  it("derives concise titles while removing only diagnostic nonce suffixes", () => {
    expect(
      deriveConversationTitle(
        "What past experience does this tender require? Check 1234567890123",
      ),
    ).toBe("Past experience requirement");
    expect(deriveConversationTitle("Tender scope? Check 1234567890123")).toBe(
      "Tender scope",
    );
    expect(
      deriveConversationTitle(
        "Explain Clause 8.2 and the 30-day delivery requirement",
      ),
    ).toContain("8.2");
    expect(
      deriveConversationTitle(
        "Explain Clause 8.2 and the 30-day delivery requirement",
      ),
    ).toContain("30-day");
  });

  it("renders saved chats as single-line rows without timestamp metadata", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) {
        return [
          {
            id: "conversation-1",
            sourceMode: "TENDER_ONLY",
            title: "Tender scope? Check 1234567890123",
            updatedAt: "2026-09-20T09:00:00.000Z",
          },
        ];
      }
      if (path.endsWith("/rag-conversations/conversation-1")) {
        return {
          answerRuns: [],
          id: "conversation-1",
          messages: [],
          sourceMode: "TENDER_ONLY",
          title: "Tender scope? Check 1234567890123",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RagChatbot
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );

    expect(await screen.findByText("Tender scope")).toBeInTheDocument();
    expect(screen.queryByText(/1234567890123/)).not.toBeInTheDocument();
    expect(document.querySelector(".chat-rail__item small")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Actions for Tender scope" }),
    ).toHaveClass("chat-rail__menu-trigger");
  });

  it("renders failed and insufficient answer runs as clean assistant cards", async () => {
    const detail = (status: string): Record<string, unknown> => ({
      answerRuns: [
        {
          citations: [],
          id: `run-${status}`,
          questionMessageId: "question-1",
          status,
        },
      ],
      id: "conversation-1",
      messages: [
        {
          content: "Tender scope? Check 1234567890123",
          id: "question-1",
          role: "USER",
        },
      ],
      sourceMode: "TENDER_ONLY",
      title: "Tender scope? Check 1234567890123",
    });
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      if (path.endsWith("/rag-conversations/conversation-1"))
        return detail("FAILED");
      throw new Error(`Unexpected API call: ${path}`);
    });
    const rendered = render(
      <RagChatbot
        initialConversationId="conversation-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    expect(
      await screen.findByText(/couldn.t generate a response/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/The answer could not be generated/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    rendered.unmount();
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      if (path.endsWith("/rag-conversations/conversation-1")) {
        return detail("INSUFFICIENT_EVIDENCE");
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    const insufficient = render(
      <RagChatbot
        initialConversationId="conversation-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    expect(
      await screen.findByText(/couldn.t find enough authorised evidence/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open tender files" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try suggested prompts" }),
    ).toBeInTheDocument();

    insufficient.unmount();
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      if (path.endsWith("/rag-conversations/conversation-1")) {
        return detail("RETRIEVING");
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    render(
      <RagChatbot
        initialConversationId="conversation-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    expect(
      await screen.findByText("Searching authorised tender sources…"),
    ).toBeInTheDocument();
  });

  it("persists a cleaned title when a new conversation starts with a diagnostic suffix", async () => {
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/rag-indexes")) {
        return [
          {
            id: "index-1",
            invalidatedAt: null,
            progressPercentage: 100,
            sourceMode: "TENDER_ONLY",
            status: "COMPLETE",
            tenderVersionId: "version-1",
          },
        ];
      }
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      if (path.endsWith("/rag-conversations") && init?.method === "POST") {
        return {
          id: "conversation-1",
          sourceMode: "TENDER_ONLY",
          title: "Past experience requirement",
        };
      }
      if (path.endsWith("/questions") && init?.method === "POST") return {};
      if (path.endsWith("/rag-conversations/conversation-1")) {
        return {
          answerRuns: [],
          id: "conversation-1",
          messages: [],
          sourceMode: "TENDER_ONLY",
          title: "Past experience requirement",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RagChatbot
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );

    const question =
      "What past experience does this tender require? Check 1234567890123";
    fireEvent.change(await screen.findByLabelText("Ask about this tender"), {
      target: { value: question },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/organisations/org-1/tenders/tender-1/rag-conversations",
        expect.objectContaining({
          body: JSON.stringify({
            source_mode: "TENDER_ONLY",
            title: "Past experience requirement",
          }),
          method: "POST",
        }),
      ),
    );
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
        initialConversationId="conversation-1"
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

  it("renders a completed answer once instead of duplicating it beside its question", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      if (path.endsWith("/rag-conversations/conversation-1")) {
        return {
          answerRuns: [
            {
              answerMessageId: "answer-1",
              citations: [],
              id: "run-1",
              questionMessageId: "question-1",
              status: "COMPLETE",
            },
          ],
          id: "conversation-1",
          messages: [
            { content: "What is required?", id: "question-1", role: "USER" },
            {
              content: "The cited requirement.",
              id: "answer-1",
              role: "ASSISTANT",
            },
          ],
          sourceMode: "TENDER_ONLY",
          title: "Requirement",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RagChatbot
        initialConversationId="conversation-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );

    expect(await screen.findByText("The cited requirement.")).toBeVisible();
    expect(document.querySelectorAll(".chat-message--assistant")).toHaveLength(
      1,
    );
  });

  it("keeps one visible question and places the latest retry beside it", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (
        path.endsWith("/rag-indexes") ||
        path.endsWith("/rag-conversations?limit=50")
      )
        return [];
      if (path.endsWith("/rag-conversations/conversation-1"))
        return {
          answerRuns: [
            {
              id: "run-old",
              questionMessageId: "question-1",
              answerMessageId: "answer-old",
              citations: [],
              status: "HUMAN_REVIEW_REQUIRED",
            },
            {
              id: "run-new",
              questionMessageId: "question-1",
              answerMessageId: "answer-new",
              citations: [],
              status: "COMPLETE",
            },
          ],
          id: "conversation-1",
          messages: [
            { content: "First question?", id: "question-1", role: "USER" },
            { content: "Old answer", id: "answer-old", role: "ASSISTANT" },
            { content: "Second question?", id: "question-2", role: "USER" },
            { content: "Latest answer", id: "answer-new", role: "ASSISTANT" },
          ],
          sourceMode: "TENDER_ONLY",
          title: "Retry history",
        };
      throw new Error(`Unexpected API call: ${path}`);
    });
    render(
      <RagChatbot
        initialConversationId="conversation-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    expect(await screen.findByText("Latest answer")).toBeVisible();
    expect(screen.queryByText("Old answer")).toBeNull();
    const content =
      document.querySelector(".chat-canvas__messages")?.textContent ?? "";
    expect(content.indexOf("First question?")).toBeLessThan(
      content.indexOf("Latest answer"),
    );
    expect(content.indexOf("Latest answer")).toBeLessThan(
      content.indexOf("Second question?"),
    );
  });

  it("labels a completed retrieval-only fallback using its persisted provider code", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (
        path.endsWith("/rag-indexes") ||
        path.endsWith("/rag-conversations?limit=50")
      )
        return [];
      if (path.endsWith("/rag-conversations/conversation-1"))
        return {
          answerRuns: [
            {
              id: "run-1",
              questionMessageId: "question-1",
              answerMessageId: "answer-1",
              citations: [],
              status: "COMPLETE",
              failureCode: "PROVIDER_TIMEOUT",
            },
          ],
          id: "conversation-1",
          messages: [
            {
              content: "What is the requirement?",
              id: "question-1",
              role: "USER",
            },
            {
              content: "Retrieved source excerpt",
              id: "answer-1",
              role: "ASSISTANT",
            },
          ],
          sourceMode: "TENDER_ONLY",
          title: "Fallback",
        };
      throw new Error(`Unexpected API call: ${path}`);
    });
    render(
      <RagChatbot
        initialConversationId="conversation-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    expect(await screen.findByText("Retrieved source excerpt")).toBeVisible();
    expect(screen.getByText("Source excerpts · AI unavailable")).toBeVisible();
  });

  it("shows the grounded answer when a tender question requires human review", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      if (path.endsWith("/rag-conversations/conversation-1")) {
        return {
          answerRuns: [
            {
              answerMessageId: "answer-1",
              citations: [
                {
                  clauseLabel: "8.2",
                  documentName: "Tender.pdf",
                  excerpt: "The requirement needs confirmation.",
                  handle: "C1",
                  pageNumber: 3,
                },
              ],
              id: "run-1",
              questionMessageId: "question-1",
              status: "HUMAN_REVIEW_REQUIRED",
            },
          ],
          id: "conversation-1",
          messages: [
            { content: "Does this apply?", id: "question-1", role: "USER" },
            {
              content: "The tender wording is ambiguous and needs review.",
              id: "answer-1",
              role: "ASSISTANT",
            },
          ],
          sourceMode: "TENDER_ONLY",
          title: "Applicability",
        };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RagChatbot
        initialConversationId="conversation-1"
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );

    expect(
      await screen.findByText(
        "The tender wording is ambiguous and needs review.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Tender.pdf")).toBeVisible();
    expect(
      screen.queryByText(/couldn.t find enough authorised evidence/i),
    ).toBeNull();
  });
  it("keeps New chat empty across polling and preserves the real failure retry", async () => {
    vi.useFakeTimers();
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes"))
        return [
          {
            id: "index-1",
            sourceMode: "TENDER_ONLY",
            status: "FAILED",
            tenderVersionId: "version-1",
            progressPercentage: 0,
          },
        ];
      if (path.endsWith("/rag-conversations?limit=50"))
        return [
          { id: "chat-1", sourceMode: "TENDER_ONLY", title: "Saved chat" },
        ];
      if (path.endsWith("/rag-conversations/chat-1"))
        return {
          id: "chat-1",
          sourceMode: "TENDER_ONLY",
          title: "Saved chat",
          messages: [],
          answerRuns: [],
        };
      return {};
    });
    render(
      <RagChatbot
        organisationId="org-1"
        initialConversationId="chat-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(
      screen.getByRole("heading", { name: "Ask about this tender" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Saved chat" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Chat shortcuts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("We couldn't prepare tender search."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "/organisations/org-1/tenders/tender-1/versions/version-1/rag-indexes",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("shows pending feedback during Retry and a safe failure if preparation is rejected", async () => {
    let rejectPreparation: ((error: Error) => void) | undefined;
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith("/rag-indexes") && init?.method === "POST")
        return new Promise((_, reject) => {
          rejectPreparation = reject;
        });
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RagChatbot
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );

    expect(
      (await screen.findAllByText("Prepare tender search")).length,
    ).toBeGreaterThan(0);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Prepare tender search" })[0]!,
    );
    expect(screen.getAllByText("Preparing tender search…")).not.toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: /Preparing tender search/ })[0],
    ).toBeDisabled();

    await act(async () => {
      rejectPreparation?.(new Error("provider unavailable"));
      await Promise.resolve();
    });
    expect(
      screen.getAllByText("We couldn't prepare tender search."),
    ).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("keeps Send disabled until a current completed tender index is loaded", async () => {
    apiRequest.mockReset();
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes")) return [];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      throw new Error(`Unexpected API call: ${path}`);
    });
    const rendered = render(
      <RagChatbot
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    const input = await screen.findByLabelText("Ask about this tender");
    fireEvent.change(input, { target: { value: "Can we bid?" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes"))
        return [
          {
            id: "index-1",
            invalidatedAt: null,
            progressPercentage: 100,
            sourceMode: "TENDER_ONLY",
            status: "COMPLETE",
            tenderVersionId: "version-1",
          },
        ];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      throw new Error(`Unexpected API call: ${path}`);
    });
    rendered.unmount();
    render(
      <RagChatbot
        organisationId="org-1"
        tenderId="tender-1"
        versionId="version-1"
      />,
    );
    fireEvent.change(await screen.findByLabelText("Ask about this tender"), {
      target: { value: "Can we bid?" },
    });
    expect(
      await screen.findByRole("button", { name: "Send message" }),
    ).toBeEnabled();
  });

  it("renders the streamlined tender chat with its tender-only conversation rail", async () => {
    apiRequest.mockImplementation((path: string) => {
      if (path.endsWith("/rag-indexes"))
        return [
          {
            id: "index-1",
            invalidatedAt: null,
            progressPercentage: 100,
            sourceMode: "TENDER_ONLY",
            status: "COMPLETE",
            tenderVersionId: "version-1",
          },
        ];
      if (path.endsWith("/rag-conversations?limit=50")) return [];
      throw new Error(`Unexpected API call: ${path}`);
    });

    render(
      <RagChatbot
        organisationId="org-1"
        streamlined
        tenderId="tender-1"
        tenderTitle="Office equipment tender"
        versionId="version-1"
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "New conversation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "How can I help?" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Using tender:")).not.toBeInTheDocument();
    expect(screen.queryByText("Sources and conversation options")).toBeNull();
    expect(document.querySelector(".chat-rail")).not.toBeNull();
    expect(screen.getByText("This tender")).toBeInTheDocument();
    expect(screen.getByText("Office equipment tender")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New chat" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search current tender chats" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Ask about this tender..."),
    ).toBeVisible();
  });
});
