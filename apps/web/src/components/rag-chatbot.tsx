"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import { apiRequest } from "../lib/api";

type SourceMode =
  | "FULL_AUTHORISED_TENDER_CONTEXT"
  | "TENDER_AND_APPROVED_COMPANY_EVIDENCE"
  | "TENDER_AND_DERIVED_WORKFLOW_RECORDS"
  | "TENDER_ONLY";

interface RagIndex {
  id: string;
  progressPercentage: number;
  sourceMode: SourceMode;
  status: string;
}

interface Conversation {
  id: string;
  sourceMode: SourceMode;
  title: string;
}

interface Message {
  content: string;
  id: string;
  role: "ASSISTANT" | "USER";
}

interface Citation {
  clauseLabel: string | null;
  documentName: string;
  excerpt: string;
  handle: string;
  pageNumber: number | null;
}

interface ConversationDetail extends Conversation {
  answerRuns: readonly {
    citations: readonly Citation[];
    id: string;
    status: string;
  }[];
  messages: readonly Message[];
}

export function RagChatbot({
  organisationId,
  tenderId,
  versionId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly versionId: string;
}): JSX.Element {
  const [indexes, setIndexes] = useState<readonly RagIndex[]>([]);
  const [conversations, setConversations] = useState<readonly Conversation[]>(
    [],
  );
  const [selectedConversation, setSelectedConversation] = useState("");
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [mode, setMode] = useState<SourceMode>("TENDER_ONLY");
  const [status, setStatus] = useState("Loading chatbot status…");

  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const load = useCallback(async (): Promise<void> => {
    try {
      const [loadedIndexes, loadedConversations] = await Promise.all([
        apiRequest<readonly RagIndex[]>(`${base}/rag-indexes`),
        apiRequest<readonly Conversation[]>(`${base}/rag-conversations`),
      ]);
      setIndexes(loadedIndexes);
      setConversations(loadedConversations);
      setSelectedConversation((current) =>
        current === "" ? (loadedConversations[0]?.id ?? "") : current,
      );
      setStatus("");
    } catch {
      setStatus("Chatbot status is unavailable.");
    }
  }, [base]);

  const loadConversation = useCallback(async (): Promise<void> => {
    if (selectedConversation === "") {
      setDetail(null);
      return;
    }
    try {
      setDetail(
        await apiRequest<ConversationDetail>(
          `${base}/rag-conversations/${selectedConversation}`,
        ),
      );
    } catch {
      setStatus("This conversation is unavailable or no longer authorised.");
    }
  }, [base, selectedConversation]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void loadConversation();
    const timer = window.setInterval(() => void loadConversation(), 2_000);
    return () => window.clearInterval(timer);
  }, [loadConversation]);

  async function buildIndex(): Promise<void> {
    setStatus("Indexing authorised sources…");
    try {
      await apiRequest(`${base}/versions/${versionId}/rag-indexes`, {
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          source_mode: mode,
        }),
        method: "POST",
      });
      await load();
    } catch {
      setStatus(
        "Indexing could not start. A current extraction, permission, and configured provider are required.",
      );
    }
  }

  async function createConversation(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const title = values.get("title");
    if (typeof title !== "string") return;
    setStatus("Creating conversation…");
    try {
      const conversation = await apiRequest<Conversation>(
        `${base}/rag-conversations`,
        {
          body: JSON.stringify({ source_mode: mode, title }),
          method: "POST",
        },
      );
      event.currentTarget.reset();
      setSelectedConversation(conversation.id);
      await load();
    } catch {
      setStatus("Create a completed current index for this source mode first.");
    }
  }

  async function ask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selectedConversation === "") return;
    const values = new FormData(event.currentTarget);
    const question = values.get("question");
    if (typeof question !== "string") return;
    setStatus("Retrieving fresh authorised evidence…");
    try {
      await apiRequest(
        `${base}/rag-conversations/${selectedConversation}/questions`,
        {
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            question,
          }),
          method: "POST",
        },
      );
      event.currentTarget.reset();
      await loadConversation();
    } catch {
      setStatus(
        "The question could not be queued. The provider or source index may be unavailable.",
      );
    }
  }

  const latestAnswer = detail?.answerRuns.at(-1);

  return (
    <section aria-labelledby="rag-heading">
      <h2 id="rag-heading">Cited tender chatbot</h2>
      <p className="warning">
        Answers are limited to authorised tender and evidence sources.
      </p>
      <p>The chatbot does not provide legal advice.</p>
      <p>Final eligibility and bidding decisions remain human-controlled.</p>
      <label>
        Authorised source mode
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as SourceMode)}
        >
          <option value="TENDER_ONLY">Tender only (default)</option>
          <option value="TENDER_AND_APPROVED_COMPANY_EVIDENCE">
            Tender and approved company evidence
          </option>
          <option value="TENDER_AND_DERIVED_WORKFLOW_RECORDS">
            Tender and derived workflow records
          </option>
          <option value="FULL_AUTHORISED_TENDER_CONTEXT">
            Full authorised tender context
          </option>
        </select>
      </label>
      <button onClick={() => void buildIndex()} type="button">
        Build current source index
      </button>
      {indexes.map((index) => (
        <p key={index.id}>
          {index.sourceMode} · {index.status} · {index.progressPercentage}%
        </p>
      ))}
      <form onSubmit={(event) => void createConversation(event)}>
        <label>
          Conversation title
          <input maxLength={160} name="title" required />
        </label>
        <button type="submit">New conversation</button>
      </form>
      <label>
        Conversation
        <select
          value={selectedConversation}
          onChange={(event) => setSelectedConversation(event.target.value)}
        >
          <option value="">Select a conversation</option>
          {conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title}
            </option>
          ))}
        </select>
      </label>
      {detail?.messages.map((message) => (
        <article key={message.id}>
          <h3>{message.role === "USER" ? "Question" : "Cited answer"}</h3>
          <p>{message.content}</p>
        </article>
      ))}
      {latestAnswer?.status === "INSUFFICIENT_EVIDENCE" && (
        <p className="warning">
          Insufficient authorised evidence. No answer was generated.
        </p>
      )}
      {latestAnswer?.status === "HUMAN_REVIEW_REQUIRED" && (
        <p className="warning">Human review is required for this question.</p>
      )}
      {latestAnswer?.status === "FAILED" && (
        <p className="warning">
          The provider is unavailable or returned an invalid response. No
          fallback answer was created.
        </p>
      )}
      {latestAnswer?.citations.map((citation) => (
        <details key={`${latestAnswer.id}:${citation.handle}`}>
          <summary>
            [{citation.handle}] {citation.documentName}
            {citation.pageNumber === null
              ? ""
              : `, page ${citation.pageNumber}`}
            {citation.clauseLabel === null
              ? ""
              : `, clause ${citation.clauseLabel}`}
          </summary>
          <p>{citation.excerpt}</p>
        </details>
      ))}
      <form onSubmit={(event) => void ask(event)}>
        <label>
          Ask about this tender
          <textarea maxLength={2_000} name="question" required rows={4} />
        </label>
        <button disabled={selectedConversation === ""} type="submit">
          Ask with fresh retrieval
        </button>
      </form>
      <p aria-live="polite">{status}</p>
    </section>
  );
}
