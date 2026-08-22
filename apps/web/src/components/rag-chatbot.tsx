"use client";

import {
  Archive,
  FileText,
  Home,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  Select,
  Textarea,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

type SourceMode =
  | "FULL_AUTHORISED_TENDER_CONTEXT"
  | "TENDER_AND_APPROVED_COMPANY_EVIDENCE"
  | "TENDER_AND_DERIVED_WORKFLOW_RECORDS"
  | "TENDER_ONLY";

interface RagIndex {
  readonly id: string;
  readonly progressPercentage: number;
  readonly sourceMode: SourceMode;
  readonly status: string;
}

interface Conversation {
  readonly archivedAt?: string | null;
  readonly id: string;
  readonly sourceMode: SourceMode;
  readonly status?: string;
  readonly title: string;
  readonly updatedAt?: string;
}

interface Message {
  readonly content: string;
  readonly id: string;
  readonly role: "ASSISTANT" | "USER";
}

interface Citation {
  readonly clauseLabel: string | null;
  readonly documentName: string;
  readonly excerpt: string;
  readonly handle: string;
  readonly pageNumber: string | number | null;
}

interface AnswerRun {
  readonly citations: readonly Citation[];
  readonly id: string;
  readonly status: string;
}

interface ConversationDetail extends Conversation {
  readonly answerRuns: readonly AnswerRun[];
  readonly messages: readonly Message[];
}

function buildConversationTitle(question: string): string {
  const trimmed = question.trim();
  if (trimmed === "") return "New tender conversation";
  return trimmed.length <= 64
    ? trimmed
    : `${trimmed.slice(0, 61).trimEnd()}...`;
}

function formatTimestamp(value: string | undefined): string {
  if (value === undefined || value === "") return "Updated recently";
  return new Date(value).toLocaleString();
}

function pinStorageKey(tenderId: string): string {
  return `tender-intelligence:pinned-chats:${tenderId}`;
}

function readPinnedIds(tenderId: string): readonly string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(pinStorageKey(tenderId));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function RagChatbot({
  organisationId,
  tenderId,
  tenderTitle,
  versionId,
}: {
  readonly organisationId: string;
  readonly tenderId: string;
  readonly tenderTitle?: string;
  readonly versionId: string;
}): JSX.Element {
  const [indexes, setIndexes] = useState<readonly RagIndex[]>([]);
  const [conversations, setConversations] = useState<readonly Conversation[]>(
    [],
  );
  const [selectedConversation, setSelectedConversation] = useState("");
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [mode, setMode] = useState<SourceMode>("TENDER_ONLY");
  const [status, setStatus] = useState("Loading chatbot status...");
  const [composer, setComposer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [busyAction, setBusyAction] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [pinnedIds, setPinnedIds] = useState<readonly string[]>(() =>
    readPinnedIds(tenderId),
  );

  const base = `/organisations/${organisationId}/tenders/${tenderId}`;

  useEffect(() => {
    setPinnedIds(readPinnedIds(tenderId));
  }, [tenderId]);

  function togglePinned(conversationId: string): void {
    setPinnedIds((current) => {
      const next = current.includes(conversationId)
        ? current.filter((id) => id !== conversationId)
        : [...current, conversationId];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          pinStorageKey(tenderId),
          JSON.stringify(next),
        );
      }
      return next;
    });
  }

  async function load(): Promise<void> {
    try {
      const [loadedIndexes, loadedConversations] = await Promise.all([
        apiRequest<readonly RagIndex[]>(`${base}/rag-indexes`),
        apiRequest<readonly Conversation[]>(
          `${base}/rag-conversations?limit=50`,
        ),
      ]);
      setIndexes(loadedIndexes);
      setConversations(loadedConversations);
      setSelectedConversation((current) => {
        if (
          current !== "" &&
          loadedConversations.some((item) => item.id === current)
        ) {
          return current;
        }
        const firstActive = loadedConversations.find(
          (item) => item.status === undefined || item.status === "ACTIVE",
        );
        return firstActive?.id ?? "";
      });
      setStatus("");
    } catch (caught) {
      setStatus(formatApiError(caught, "Chatbot status is unavailable."));
    }
  }

  async function loadConversation(): Promise<void> {
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
    } catch (caught) {
      setStatus(
        formatApiError(
          caught,
          "This conversation is unavailable or no longer authorised.",
        ),
      );
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [base]);

  useEffect(() => {
    void loadConversation();
    const timer = window.setInterval(() => void loadConversation(), 2_000);
    return () => window.clearInterval(timer);
  }, [base, selectedConversation]);

  const currentIndex = indexes.find((item) => item.sourceMode === mode) ?? null;
  const currentIndexTone =
    currentIndex?.status === "FAILED"
      ? "danger"
      : currentIndex?.status === "COMPLETE"
        ? "success"
        : "info";
  const currentIndexNote =
    currentIndex?.status === "FAILED"
      ? "AI search preparation failed safely for this tender scope. Retry building the current index."
      : "Persistent chats exist per tender. Pinning, renaming, and cross-tender history are not currently supported.";
  const filteredConversations = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return conversations.filter((item) => {
      if (query === "") return true;
      return item.title.toLowerCase().includes(query);
    });
  }, [conversations, deferredSearch]);
  const pinnedConversations = filteredConversations.filter((item) =>
    pinnedIds.includes(item.id),
  );
  const recentConversations = filteredConversations.filter(
    (item) => !pinnedIds.includes(item.id),
  );

  const starterPrompts = [
    "Summarise the biggest eligibility blockers in this tender.",
    "What evidence is still missing before we can proceed confidently?",
    "What should I ask the drafting team to prepare next?",
  ];

  const pairedMessages = useMemo(() => {
    if (detail === null) return [];
    let assistantIndex = -1;
    return detail.messages.map((message) => {
      const answerRun =
        message.role === "ASSISTANT"
          ? (detail.answerRuns[++assistantIndex] ?? null)
          : null;
      return { answerRun, message };
    });
  }, [detail]);

  async function buildIndex(): Promise<void> {
    setBusyAction("index");
    setStatus("Indexing authorised sources...");
    try {
      await apiRequest(`${base}/versions/${versionId}/rag-indexes`, {
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          source_mode: mode,
        }),
        method: "POST",
      });
      await load();
      setStatus("A current source index has been queued.");
    } catch (caught) {
      setStatus(
        formatApiError(
          caught,
          "Indexing could not start. A current extraction, permission, and configured provider are required.",
        ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function createConversation(question: string): Promise<string | null> {
    try {
      const conversation = await apiRequest<Conversation>(
        `${base}/rag-conversations`,
        {
          body: JSON.stringify({
            source_mode: mode,
            title:
              draftTitle.trim() === ""
                ? buildConversationTitle(question)
                : draftTitle.trim(),
          }),
          method: "POST",
        },
      );
      setDraftTitle("");
      setSelectedConversation(conversation.id);
      await load();
      return conversation.id;
    } catch (caught) {
      setStatus(
        formatApiError(
          caught,
          "Create a completed current index for this source mode first.",
        ),
      );
      return null;
    }
  }

  async function ask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const question = composer.trim();
    if (question === "") return;
    let conversationId = selectedConversation;
    setBusyAction("ask");
    setStatus("Retrieving fresh authorised evidence...");
    try {
      if (conversationId === "") {
        const created = await createConversation(question);
        if (created === null) return;
        conversationId = created;
      }
      await apiRequest(
        `${base}/rag-conversations/${conversationId}/questions`,
        {
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            question,
          }),
          method: "POST",
        },
      );
      setComposer("");
      await loadConversation();
    } catch (caught) {
      setStatus(
        formatApiError(
          caught,
          "The question could not be queued. The provider or source index may be unavailable.",
        ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function archiveConversation(): Promise<void> {
    if (selectedConversation === "") return;
    setBusyAction("archive");
    try {
      await apiRequest(
        `${base}/rag-conversations/${selectedConversation}/archive`,
        {
          method: "PATCH",
        },
      );
      setSelectedConversation("");
      await load();
      setStatus("Conversation archived.");
    } catch (caught) {
      setStatus(
        formatApiError(caught, "The conversation could not be archived."),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function deleteConversation(conversationId: string): Promise<void> {
    setBusyAction(conversationId);
    try {
      await apiRequest(`${base}/rag-conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (selectedConversation === conversationId) setSelectedConversation("");
      await load();
      setStatus("Conversation deleted.");
    } catch (caught) {
      setStatus(
        formatApiError(caught, "The conversation could not be deleted."),
      );
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="chat-workspace">
      <aside className="workspace-card chat-rail">
        <div className="chat-rail__identity">
          <span className="workspace-sidebar__brand-mark" aria-hidden="true">
            TI
          </span>
          <div>
            <strong>Tender Intelligence</strong>
            <small>AI Chat</small>
          </div>
        </div>

        <nav aria-label="Chat actions" className="chat-rail__shortcuts">
          <button
            className="chat-rail__shortcut"
            onClick={() => {
              setSelectedConversation("");
              setDetail(null);
              setDraftTitle("");
              setComposer("");
            }}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            <span>New chat</span>
          </button>
          <label className="chat-rail__shortcut chat-rail__search">
            <Search aria-hidden="true" size={16} />
            <Input
              aria-label="Search current tender chats"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search chats"
              value={searchQuery}
            />
          </label>
        </nav>

        <nav aria-label="Chat shortcuts" className="chat-rail__shortcuts">
          <Link className="chat-rail__shortcut" href="/dashboard">
            <Home aria-hidden="true" size={16} />
            <span>Home</span>
          </Link>
          <Link
            className="chat-rail__shortcut"
            href={`/tenders/${organisationId}`}
          >
            <FileText aria-hidden="true" size={16} />
            <span>Tenders</span>
          </Link>
          <Link
            className="chat-rail__shortcut"
            href={`/documents/${organisationId}`}
          >
            <FileText aria-hidden="true" size={16} />
            <span>Company Docs</span>
          </Link>
        </nav>

        {pinnedConversations.length > 0 ? (
          <div className="chat-rail__group">
            <div className="chat-rail__group-header">
              <strong>Pinned</strong>
            </div>
            <div className="chat-rail__list">
              {pinnedConversations.map((conversation) => (
                <div
                  className={`chat-rail__item ${selectedConversation === conversation.id ? "chat-rail__item--active" : ""}`}
                  key={conversation.id}
                >
                  <button
                    className="chat-rail__item-button"
                    onClick={() => setSelectedConversation(conversation.id)}
                    type="button"
                  >
                    <span>{conversation.title}</span>
                    <small>{formatTimestamp(conversation.updatedAt)}</small>
                  </button>
                  <IconButton
                    className="chat-rail__item-action"
                    label={`Unpin ${conversation.title}`}
                    onClick={() => togglePinned(conversation.id)}
                  >
                    <Star aria-hidden="true" fill="currentColor" size={14} />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="chat-rail__group">
          <div className="chat-rail__group-header">
            <strong>Recent</strong>
          </div>
          {recentConversations.length === 0 ? (
            <p className="workspace-sidebar__empty">
              {filteredConversations.length === 0
                ? "No saved conversations for this tender yet."
                : "No unpinned conversations match this search."}
            </p>
          ) : (
            <div className="chat-rail__list">
              {recentConversations.map((conversation) => (
                <div
                  className={`chat-rail__item ${selectedConversation === conversation.id ? "chat-rail__item--active" : ""}`}
                  key={conversation.id}
                >
                  <button
                    className="chat-rail__item-button"
                    onClick={() => setSelectedConversation(conversation.id)}
                    type="button"
                  >
                    <span>{conversation.title}</span>
                    <small>{formatTimestamp(conversation.updatedAt)}</small>
                  </button>
                  <div className="chat-rail__item-actions">
                    <IconButton
                      label={`Pin ${conversation.title}`}
                      onClick={() => togglePinned(conversation.id)}
                    >
                      <Star aria-hidden="true" size={14} />
                    </IconButton>
                    <IconButton
                      label={`Delete ${conversation.title}`}
                      onClick={() => void deleteConversation(conversation.id)}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="chat-rail__footer">
          <Link
            className="chat-rail__shortcut"
            href={`/settings/${organisationId}`}
          >
            <Settings aria-hidden="true" size={16} />
            <span>Settings</span>
          </Link>
          <span className="chat-rail__shortcut chat-rail__shortcut--disabled">
            <MessageSquare aria-hidden="true" size={16} />
            <span>Help</span>
          </span>
          <Link className="chat-rail__shortcut" href="/account">
            <UserRound aria-hidden="true" size={16} />
            <span>Account</span>
          </Link>
        </div>
      </aside>

      <section className="workspace-card chat-canvas">
        <header className="chat-canvas__header">
          <div>
            <div className="chat-canvas__context">
              <span>Using tender:</span>
              <strong>{tenderTitle ?? tenderId}</strong>
            </div>
            <h2>
              {detail?.title ??
                (selectedConversation === ""
                  ? "New tender conversation"
                  : "Tender conversation")}
            </h2>
            <p>
              Answers remain grounded in authorised tender and company evidence
              sources only. No legal advice or autonomous bid decisions are made
              here.
            </p>
          </div>

          <div className="chat-canvas__controls">
            <label className="chat-canvas__mode">
              <span>Source mode</span>
              <Select
                onChange={(event) => setMode(event.target.value as SourceMode)}
                value={mode}
              >
                <option value="TENDER_ONLY">Tender only</option>
                <option value="TENDER_AND_APPROVED_COMPANY_EVIDENCE">
                  Tender and approved company evidence
                </option>
                <option value="TENDER_AND_DERIVED_WORKFLOW_RECORDS">
                  Tender and derived workflow records
                </option>
                <option value="FULL_AUTHORISED_TENDER_CONTEXT">
                  Full authorised tender context
                </option>
              </Select>
            </label>
            <Button
              loading={busyAction === "index"}
              onClick={() => void buildIndex()}
              variant="secondary"
            >
              Build current index
            </Button>
            {selectedConversation !== "" ? (
              <Button
                loading={busyAction === "archive"}
                onClick={() => void archiveConversation()}
                variant="quiet"
              >
                <Archive aria-hidden="true" size={16} />
                Archive
              </Button>
            ) : null}
          </div>
        </header>

        <div className="chat-canvas__status-row">
          <Badge tone={currentIndexTone}>
            {currentIndex === null
              ? "No current index"
              : `${humanizeEnum(currentIndex.status)} (${currentIndex.progressPercentage}%)`}
          </Badge>
          <Badge tone="neutral">{humanizeEnum(mode)}</Badge>
          <span className="chat-canvas__status-note">{currentIndexNote}</span>
        </div>

        <div className="chat-canvas__messages">
          {detail === null && selectedConversation === "" ? (
            <EmptyState
              description="Start a new tender-scoped conversation. The first prompt can also become the saved conversation title."
              title="No conversation selected"
            />
          ) : pairedMessages.length === 0 ? (
            <EmptyState
              description="Ask a tender question to start a cited conversation."
              title="Conversation ready"
            />
          ) : (
            pairedMessages.map(({ answerRun, message }) => (
              <article
                className={`chat-message chat-message--${message.role === "USER" ? "user" : "assistant"}`}
                key={message.id}
              >
                <div className="chat-message__meta">
                  <strong>
                    {message.role === "USER" ? "You" : "Tender Intelligence"}
                  </strong>
                  {answerRun !== null ? (
                    <Badge
                      tone={
                        answerRun.status === "COMPLETED" ? "success" : "warning"
                      }
                    >
                      {humanizeEnum(answerRun.status)}
                    </Badge>
                  ) : null}
                </div>
                <p>{message.content}</p>
                {answerRun?.status === "INSUFFICIENT_EVIDENCE" ? (
                  <Alert
                    tone="warning"
                    title="Insufficient authorised evidence"
                  >
                    <p>No answer could be grounded for this question.</p>
                  </Alert>
                ) : null}
                {answerRun?.status === "HUMAN_REVIEW_REQUIRED" ? (
                  <Alert tone="warning" title="Human review required">
                    <p>This answer path requires explicit human review.</p>
                  </Alert>
                ) : null}
                {answerRun?.status === "FAILED" ? (
                  <Alert tone="danger" title="Provider unavailable">
                    <p>No fallback answer was generated for this question.</p>
                  </Alert>
                ) : null}
                {answerRun !== null && answerRun.citations.length > 0 ? (
                  <div className="chat-citation-list">
                    {answerRun.citations.map((citation) => (
                      <Card
                        className="chat-citation-card"
                        key={`${answerRun.id}:${citation.handle}`}
                      >
                        <strong>
                          [{citation.handle}] {citation.documentName}
                        </strong>
                        <p>{citation.excerpt}</p>
                        <small>
                          {citation.pageNumber === null
                            ? "Page unavailable"
                            : `Page ${citation.pageNumber}`}
                          {citation.clauseLabel === null
                            ? ""
                            : `, clause ${citation.clauseLabel}`}
                        </small>
                      </Card>
                    ))}
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>

        <div className="chat-suggestions">
          {starterPrompts.map((prompt) => (
            <button
              className="chat-suggestions__chip"
              key={prompt}
              onClick={() => setComposer(prompt)}
              type="button"
            >
              {prompt}
            </button>
          ))}
        </div>

        <form className="chat-composer" onSubmit={(event) => void ask(event)}>
          {selectedConversation === "" ? (
            <Input
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="Optional title for the new saved conversation"
              value={draftTitle}
            />
          ) : null}
          <Textarea
            aria-label="Ask about this tender"
            maxLength={2_000}
            onChange={(event) => setComposer(event.target.value)}
            placeholder="Ask about this tender using fresh retrieval"
            rows={4}
            value={composer}
          />
          <div className="chat-composer__actions">
            <span aria-live="polite" className="chat-composer__status">
              {status}
            </span>
            <Button loading={busyAction === "ask"} type="submit">
              Ask with fresh retrieval
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
