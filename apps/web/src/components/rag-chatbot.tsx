"use client";

import { Archive, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import {
  Fragment,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from "react";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Textarea,
  humanizeEnum,
} from "@tender/ui";
import { apiRequest, PublicApiError } from "../lib/api";

function chatError(error: unknown, fallback: string): string {
  if (error instanceof PublicApiError) {
    if (error.status === 409)
      return "Tender search has changed. Prepare the current sources and start a new chat.";
    if (error.status === 403)
      return "You don't have permission to perform this chat action.";
    if (error.status === 401)
      return "Your session has expired. Please sign in again.";
  }
  return fallback;
}

type SourceMode =
  | "FULL_AUTHORISED_TENDER_CONTEXT"
  | "TENDER_AND_APPROVED_COMPANY_EVIDENCE"
  | "TENDER_AND_DERIVED_WORKFLOW_RECORDS"
  | "TENDER_ONLY";

interface RagIndex {
  readonly tenderVersionId?: string;
  readonly invalidatedAt?: string | null;
  readonly id: string;
  readonly progressPercentage: number;
  readonly sourceMode: SourceMode;
  readonly status: string;
}

interface Conversation {
  readonly indexRunId?: string;
  readonly tenderVersionId?: string;
  readonly archivedAt?: string | null;
  readonly id: string;
  readonly sourceMode: SourceMode;
  readonly status?: string;
  readonly pinned?: boolean;
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
  readonly answerMessageId?: string | null;
  readonly citations: readonly Citation[];
  readonly failureCode?: string | null;
  readonly id: string;
  readonly questionMessageId?: string;
  readonly status: string;
}

interface ConversationDetail extends Conversation {
  readonly answerRuns: readonly AnswerRun[];
  readonly messages: readonly Message[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeIndexes(value: unknown): readonly RagIndex[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is RagIndex =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.progressPercentage === "number" &&
      typeof item.sourceMode === "string" &&
      typeof item.status === "string",
  );
}

function normalizeConversations(value: unknown): readonly Conversation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Conversation =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.sourceMode === "string" &&
      (typeof item.title === "string" || item.title === null),
  );
}

function normalizeConversationDetail(
  value: ConversationDetail,
): ConversationDetail {
  const answerRuns = Array.isArray(value.answerRuns)
    ? value.answerRuns
        .filter(
          (run): run is AnswerRun =>
            isRecord(run) &&
            typeof run.id === "string" &&
            typeof run.status === "string",
        )
        .map((run) => ({
          ...run,
          citations: Array.isArray(run.citations) ? run.citations : [],
        }))
    : [];
  const messages = Array.isArray(value.messages)
    ? value.messages.filter(
        (message): message is Message =>
          isRecord(message) &&
          typeof message.content === "string" &&
          typeof message.id === "string" &&
          (message.role === "ASSISTANT" || message.role === "USER"),
      )
    : [];
  return {
    ...value,
    title: deriveConversationTitle(value.title || "Untitled conversation"),
    answerRuns,
    messages,
  };
}

const DIAGNOSTIC_TITLE_SUFFIX = /\s+(?:[?!.,]\s*)?check\s+\d{10,}\s*$/i;

function withoutDiagnosticSuffix(value: string): string {
  return value.replace(DIAGNOSTIC_TITLE_SUFFIX, "").trim();
}

export function deriveConversationTitle(question: string): string {
  const cleaned = withoutDiagnosticSuffix(question.trim());
  if (cleaned === "") return "New tender conversation";
  const normalized = cleaned.toLowerCase();
  if (
    normalized.includes("past experience") &&
    normalized.includes("require")
  ) {
    return "Past experience requirement";
  }
  if (normalized.startsWith("tender scope")) return "Tender scope";
  if (normalized.includes("evidence") && normalized.includes("missing")) {
    return "Missing tender evidence";
  }
  if (normalized.includes("performance security")) {
    return "Performance security clause";
  }
  if (normalized.includes("drafting team") && normalized.includes("prepare")) {
    return "Draft preparation next steps";
  }
  return cleaned.length <= 60
    ? cleaned
    : `${cleaned.slice(0, 57).trimEnd()}...`;
}

function ConversationRow({
  conversation,
  deleteConversation,
  isActive,
  isMenuOpen,
  onOpen,
  onToggleMenu,
  onTogglePin,
}: {
  readonly conversation: Conversation;
  readonly deleteConversation: (conversationId: string) => Promise<void>;
  readonly isActive: boolean;
  readonly isMenuOpen: boolean;
  readonly onOpen: () => void;
  readonly onToggleMenu: () => void;
  readonly onTogglePin: () => void;
}): JSX.Element {
  return (
    <div
      className={`chat-rail__item ${isActive ? "chat-rail__item--active" : ""}`}
    >
      <button className="chat-rail__item-button" onClick={onOpen} type="button">
        <span className="chat-rail__item-title" title={conversation.title}>
          {conversation.title}
        </span>
      </button>
      <div className="chat-rail__item-menu">
        <button
          aria-expanded={isMenuOpen}
          aria-haspopup="menu"
          aria-label={`Actions for ${conversation.title}`}
          className="chat-rail__menu-trigger"
          onClick={onToggleMenu}
          type="button"
        >
          <MoreHorizontal aria-hidden="true" size={16} />
        </button>
        {isMenuOpen ? (
          <div className="chat-rail__menu-popover">
            <Button type="button" variant="quiet" onClick={onTogglePin}>
              {conversation.pinned ? "Unpin" : "Pin"}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => void deleteConversation(conversation.id)}
            >
              <Trash2 aria-hidden="true" size={14} />
              Delete
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type AssistantResponseState =
  | "answered"
  | "failed"
  | "insufficient_evidence"
  | "loading"
  | "review_required";

const providerFailureCodes = new Set([
  "AI_PROVIDER_UNAVAILABLE",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_DEPENDENCY_UNAVAILABLE",
  "PROVIDER_MODEL_UNAVAILABLE",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_QUOTA_EXHAUSTED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_SERVICE_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
]);

function assistantResponseState(status: string): AssistantResponseState {
  if (["COMPLETE", "COMPLETED"].includes(status)) return "answered";
  if (status === "INSUFFICIENT_EVIDENCE") return "insufficient_evidence";
  if (status === "HUMAN_REVIEW_REQUIRED") return "review_required";
  if (
    ["QUEUED", "RETRIEVING", "GENERATING", "VERIFYING_CITATIONS"].includes(
      status,
    )
  ) {
    return "loading";
  }
  return "failed";
}

function ChatCitations({ run }: { readonly run: AnswerRun }): JSX.Element {
  if (run.citations.length === 0) return <></>;
  return (
    <div className="chat-citation-list">
      {run.citations.map((citation) => (
        <div
          className="chat-citation-card"
          key={`${run.id}:${citation.handle}`}
          title={citation.excerpt}
        >
          <strong>{citation.documentName}</strong>
          <small>
            {citation.pageNumber === null
              ? "Page unavailable"
              : `p. ${citation.pageNumber}`}
            {citation.clauseLabel === null ? "" : ` · ${citation.clauseLabel}`}
          </small>
        </div>
      ))}
    </div>
  );
}

function AssistantResponse({
  answer,
  onRetry,
  onShowSuggestions,
  run,
  tenderFilesHref,
}: {
  readonly answer?: string;
  readonly onRetry: () => void;
  readonly onShowSuggestions: () => void;
  readonly run: AnswerRun;
  readonly tenderFilesHref: string;
}): JSX.Element {
  const state = assistantResponseState(run.status);
  if (state === "loading") {
    const copy = ["QUEUED", "RETRIEVING"].includes(run.status)
      ? "Searching authorised tender sources…"
      : "Preparing grounded answer…";
    return (
      <article
        aria-live="polite"
        className="chat-message chat-message--assistant chat-response-card chat-response-card--loading"
      >
        <strong>Tender Intelligence</strong>
        <p>{copy}</p>
      </article>
    );
  }
  if (state === "insufficient_evidence") {
    return (
      <article className="chat-message chat-message--assistant chat-response-card chat-response-card--insufficient">
        <strong>Tender Intelligence</strong>
        <p>
          I couldn’t find enough authorised evidence in the current tender
          sources to answer that confidently.
        </p>
        <p className="chat-response-card__hint">
          Try a broader wording, review the tender files, or choose a suggested
          question.
        </p>
        <div className="chat-response-card__actions">
          <Button onClick={onRetry} type="button" variant="secondary">
            Retry
          </Button>
          <a className="button button--quiet" href={tenderFilesHref}>
            Open tender files
          </a>
          <Button onClick={onShowSuggestions} type="button" variant="quiet">
            Try suggested prompts
          </Button>
        </div>
      </article>
    );
  }
  if (state === "review_required") {
    return (
      <article className="chat-message chat-message--assistant chat-response-card chat-response-card--review">
        <strong>Tender Intelligence</strong>
        <p>
          {answer ??
            "The tender evidence raises a point that requires human review."}
        </p>
        <ChatCitations run={run} />
      </article>
    );
  }
  if (state === "failed") {
    const providerUnavailable = providerFailureCodes.has(run.failureCode ?? "");
    return (
      <article className="chat-message chat-message--assistant chat-response-card chat-response-card--failed">
        <strong>Tender Intelligence</strong>
        <p>
          {providerUnavailable
            ? "The AI service was temporarily unavailable. Your question and tender evidence are saved."
            : "We couldn’t generate a response."}
        </p>
        <div className="chat-response-card__actions">
          <Button onClick={onRetry} type="button" variant="secondary">
            Retry
          </Button>
        </div>
      </article>
    );
  }
  return (
    <article className="chat-message chat-message--assistant">
      <div className="chat-message__meta">
        <strong>Tender Intelligence</strong>
        {run.failureCode ? <span>Source excerpts · AI unavailable</span> : null}
      </div>
      <p>{answer}</p>
      <ChatCitations run={run} />
    </article>
  );
}

export function RagChatbot({
  organisationId,
  initialConversationId,
  tenderId,
  tenderTitle,
  versionId,
  compact = false,
  embedded = false,
  streamlined = false,
  onConversationChange,
}: {
  readonly organisationId: string;
  readonly initialConversationId?: string;
  readonly tenderId: string;
  readonly tenderTitle?: string;
  readonly versionId: string;
  readonly compact?: boolean;
  readonly embedded?: boolean;
  readonly streamlined?: boolean;
  readonly onConversationChange?: (id: string) => void;
}): JSX.Element {
  const [readinessLoaded, setReadinessLoaded] = useState(false);
  const [sendConflict, setSendConflict] = useState(false);
  const [indexes, setIndexes] = useState<readonly RagIndex[]>([]);
  const [conversations, setConversations] = useState<readonly Conversation[]>(
    [],
  );
  const [selectedConversation, setSelectedConversation] = useState(
    initialConversationId === "new" ? "" : (initialConversationId ?? ""),
  );
  const activeSelection = useRef(selectedConversation);
  activeSelection.current = selectedConversation;
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [mode, setMode] = useState<SourceMode>("TENDER_ONLY");
  const [status, setStatus] = useState("Loading chatbot status...");
  const [composer, setComposer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [busyAction, setBusyAction] = useState("");
  const [indexFailure, setIndexFailure] = useState(false);
  const [openMenuId, setOpenMenuId] = useState("");

  const base = `/organisations/${organisationId}/tenders/${tenderId}`;
  const tenderFilesHref = `/tenders/${organisationId}/${tenderId}?stage=files`;

  useEffect(() => {
    const requested =
      initialConversationId === "new" ? "" : (initialConversationId ?? "");
    if (requested === activeSelection.current) return;
    setSelectedConversation(requested);
    setDetail(null);
    setComposer("");
    setSendConflict(false);
  }, [initialConversationId, base]);

  async function load(): Promise<void> {
    try {
      const [loadedIndexes, loadedConversations] = await Promise.all([
        apiRequest<readonly RagIndex[]>(`${base}/rag-indexes`),
        apiRequest<readonly Conversation[]>(
          `${base}/rag-conversations?limit=50`,
        ),
      ]);
      const safeIndexes = normalizeIndexes(loadedIndexes);
      const safeConversations = normalizeConversations(loadedConversations);
      setIndexes(safeIndexes);
      setReadinessLoaded(true);
      setConversations(
        safeConversations.map((item) => ({
          ...item,
          title: deriveConversationTitle(item.title || "Untitled conversation"),
        })),
      );
      setStatus("");
    } catch (caught) {
      setReadinessLoaded(false);
      setStatus(chatError(caught, "Tender search status is unavailable."));
    }
  }

  async function loadConversation(): Promise<void> {
    if (selectedConversation === "") {
      setDetail(null);
      return;
    }
    try {
      const loaded = await apiRequest<ConversationDetail>(
        `${base}/rag-conversations/${selectedConversation}`,
      );
      if (activeSelection.current !== selectedConversation) return;
      setDetail(normalizeConversationDetail(loaded));
    } catch (caught) {
      setStatus(
        chatError(
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

  const activeMode = detail?.sourceMode ?? mode;
  const currentIndex =
    indexes.find((item) =>
      detail?.indexRunId !== undefined
        ? item.id === detail.indexRunId
        : item.sourceMode === activeMode &&
          item.tenderVersionId === versionId &&
          item.invalidatedAt === null &&
          item.status === "COMPLETE",
    ) ??
    indexes.find(
      (item) =>
        item.sourceMode === activeMode && item.tenderVersionId === versionId,
    ) ??
    null;
  const searchReady =
    readinessLoaded &&
    !sendConflict &&
    currentIndex?.status === "COMPLETE" &&
    currentIndex.invalidatedAt === null &&
    currentIndex.tenderVersionId === versionId &&
    (selectedConversation === ""
      ? true
      : detail !== null &&
        detail.indexRunId === currentIndex.id &&
        detail.status === "ACTIVE");
  const preparing =
    currentIndex !== null &&
    ["QUEUED", "CHUNKING", "EMBEDDING", "INDEXING", "VALIDATING"].includes(
      currentIndex.status,
    );
  const currentIndexTone =
    currentIndex?.status === "FAILED"
      ? "danger"
      : currentIndex?.status === "COMPLETE"
        ? "success"
        : "info";
  const filteredConversations = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return conversations.filter((item) => {
      if (query === "") return true;
      return item.title.toLowerCase().includes(query);
    });
  }, [conversations, deferredSearch]);
  const pinnedConversations = filteredConversations.filter(
    (conversation) => conversation.pinned,
  );
  const recentConversations = filteredConversations.filter(
    (conversation) => !conversation.pinned,
  );

  const starterPrompts = [
    "Summarise the biggest eligibility blockers in this tender.",
    "What evidence is still missing before we can proceed confidently?",
    "What should I ask the drafting team to prepare next?",
  ];

  const pairedMessages = useMemo(() => {
    if (detail === null) return [];
    const latestRunByQuestion = new Map<string, AnswerRun>();
    for (const run of detail.answerRuns)
      if (run.questionMessageId)
        latestRunByQuestion.set(run.questionMessageId, run);
    const historicalAnswerIds = new Set(
      detail.answerRuns.map((run) => run.answerMessageId).filter(Boolean),
    );
    const messageById = new Map(
      detail.messages.map((message) => [message.id, message]),
    );
    const visibleMessages: Message[] = [];
    for (const message of detail.messages) {
      if (message.role === "ASSISTANT" && historicalAnswerIds.has(message.id))
        continue;
      visibleMessages.push(message);
      if (message.role === "USER") {
        const answerId = latestRunByQuestion.get(message.id)?.answerMessageId;
        const answer = answerId ? messageById.get(answerId) : undefined;
        if (answer) visibleMessages.push(answer);
      }
    }
    return visibleMessages.map((message) => {
      const answerRun =
        message.role === "ASSISTANT"
          ? (detail.answerRuns.find(
              (run) => run.answerMessageId === message.id,
            ) ?? null)
          : null;
      const questionRun =
        message.role === "USER"
          ? (latestRunByQuestion.get(message.id) ?? null)
          : null;
      return { answerRun, message, questionRun };
    });
  }, [detail]);

  async function buildIndex(): Promise<void> {
    setBusyAction("index");
    setIndexFailure(false);
    setStatus("Preparing tender search…");
    try {
      await apiRequest(`${base}/versions/${versionId}/rag-indexes`, {
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          source_mode: activeMode,
        }),
        method: "POST",
      });
      await load();
      setStatus("Preparing tender search…");
    } catch (caught) {
      setIndexFailure(true);
      setStatus(chatError(caught, "We couldn't prepare tender search."));
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
            source_mode: activeMode,
            title: deriveConversationTitle(question),
          }),
          method: "POST",
        },
      );
      setSelectedConversation(conversation.id);
      await load();
      return conversation.id;
    } catch (caught) {
      setStatus(
        chatError(
          caught,
          "Create a completed current index for this source mode first.",
        ),
      );
      return null;
    }
  }

  async function queueQuestion(question: string): Promise<void> {
    if (question === "" || !searchReady || busyAction !== "") return;
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
      const saved = await apiRequest<ConversationDetail>(
        `${base}/rag-conversations/${conversationId}`,
      );
      setDetail(normalizeConversationDetail(saved));
      await load();
      window.dispatchEvent(new Event("conversations-changed"));
      onConversationChange?.(conversationId);
    } catch (caught) {
      if (caught instanceof PublicApiError && caught.status === 409)
        setSendConflict(true);
      setStatus(
        chatError(
          caught,
          "The question could not be queued. The provider or source index may be unavailable.",
        ),
      );
    } finally {
      setBusyAction("");
    }
  }

  async function retryAnswer(runId: string): Promise<void> {
    if (busyAction !== "" || selectedConversation === "") return;
    setBusyAction(`retry:${runId}`);
    try {
      await apiRequest(`${base}/rag-answers/${runId}/retry`, {
        method: "POST",
      });
      await loadConversation();
      await load();
    } catch (caught) {
      setStatus(chatError(caught, "The response could not be retried."));
    } finally {
      setBusyAction("");
    }
  }

  async function ask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await queueQuestion(composer.trim());
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
      setStatus(chatError(caught, "The conversation could not be archived."));
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
      setStatus(chatError(caught, "The conversation could not be deleted."));
    } finally {
      setBusyAction("");
    }
  }

  function renderConversation(conversation: Conversation): JSX.Element {
    return (
      <ConversationRow
        conversation={conversation}
        deleteConversation={deleteConversation}
        isActive={selectedConversation === conversation.id}
        isMenuOpen={openMenuId === conversation.id}
        key={conversation.id}
        onOpen={() => {
          setSendConflict(false);
          setDetail(null);
          setMode(conversation.sourceMode);
          setSelectedConversation(conversation.id);
          onConversationChange?.(conversation.id);
        }}
        onToggleMenu={() =>
          setOpenMenuId((current) =>
            current === conversation.id ? "" : conversation.id,
          )
        }
        onTogglePin={() =>
          void apiRequest(
            `/organisations/${organisationId}/conversations/${conversation.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({ pinned: !conversation.pinned }),
            },
          )
            .then(() => {
              setOpenMenuId("");
              return load();
            })
            .catch((caught) =>
              setStatus(chatError(caught, "Pin could not be saved.")),
            )
        }
      />
    );
  }

  return (
    <div
      className={`chat-workspace ${embedded ? "chat-workspace--embedded" : ""} ${streamlined ? "chat-workspace--streamlined" : ""} ${compact ? "chat-workspace--compact" : ""}`}
    >
      {!embedded ? (
        <aside className="workspace-card chat-rail">
          {!streamlined ? (
            <div className="chat-rail__identity">
              <span
                className="workspace-sidebar__brand-mark"
                aria-hidden="true"
              >
                TI
              </span>
              <div>
                <strong>Tender Intelligence</strong>
                <small>AI Chat</small>
              </div>
            </div>
          ) : null}

          <nav aria-label="Chat actions" className="chat-rail__shortcuts">
            <button
              className="chat-rail__shortcut"
              onClick={() => {
                setSendConflict(false);
                setSelectedConversation("");
                onConversationChange?.("new");
                setDetail(null);
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

          <div className="chat-rail__scroll">
            {streamlined ? (
              <div className="chat-rail__scope">
                <div className="chat-rail__group-header">
                  <strong>This tender</strong>
                </div>
                <strong className="chat-rail__scope-title">
                  {tenderTitle ?? "Current tender"}
                </strong>
              </div>
            ) : null}
            <div className="chat-rail__group">
              {pinnedConversations.length > 0 ? (
                <>
                  <div className="chat-rail__group-header">
                    <strong>Pinned</strong>
                  </div>
                  <div className="chat-rail__list">
                    {pinnedConversations.map(renderConversation)}
                  </div>
                </>
              ) : null}
              <div className="chat-rail__group-header">
                <strong>Recent</strong>
              </div>
              {recentConversations.length === 0 ? (
                <p className="workspace-sidebar__empty">
                  {filteredConversations.length === 0
                    ? "No saved conversations for this tender yet."
                    : "No saved conversations match this search."}
                </p>
              ) : (
                <div className="chat-rail__list">
                  {recentConversations.map(renderConversation)}
                </div>
              )}
            </div>
          </div>
        </aside>
      ) : null}

      <section className="workspace-card chat-canvas">
        {!compact ? (
          <header className="chat-canvas__header">
            <div>
              {streamlined ? (
                <small>Tender</small>
              ) : (
                <div className="chat-canvas__context">
                  <span>Using tender:</span>
                  <strong>{tenderTitle ?? tenderId}</strong>
                </div>
              )}
              <h2>
                {detail?.title ??
                  (selectedConversation === ""
                    ? streamlined
                      ? "New conversation"
                      : "New tender conversation"
                    : "Tender conversation")}
              </h2>
              <p>
                Answers remain grounded in authorised tender and company
                evidence sources only. No legal advice or autonomous bid
                decisions are made here.
              </p>
            </div>
          </header>
        ) : null}
        {!searchReady ? (
          <div className="chat-canvas__failure" role="status">
            <div>
              <strong>
                {busyAction === "index" || preparing
                  ? "Preparing tender search…"
                  : indexFailure
                    ? "We couldn't prepare tender search."
                    : currentIndex?.status === "FAILED"
                      ? "We couldn't prepare tender search."
                      : "Prepare tender search"}
              </strong>
              <p id="chat-readiness-reason">
                {indexFailure
                  ? "Try again to prepare the authorised sources for this tender."
                  : "Tender search must be ready before sending source-grounded questions."}
              </p>
              {detail?.indexRunId && currentIndex?.invalidatedAt != null ? (
                <small>
                  This conversation uses an older source index. After
                  preparation, choose New chat.
                </small>
              ) : null}
            </div>
            <Button
              disabled={preparing || busyAction !== ""}
              loading={busyAction === "index"}
              onClick={() => void buildIndex()}
              variant="quiet"
            >
              {preparing || busyAction === "index"
                ? "Preparing tender search…"
                : currentIndex === null && !indexFailure
                  ? "Prepare tender search"
                  : "Retry"}
            </Button>
          </div>
        ) : null}
        {!compact && !streamlined ? (
          <details className="chat-advanced">
            <summary>Sources and conversation options</summary>
            <div className="chat-canvas__controls">
              <label className="chat-canvas__mode">
                <span>Source mode</span>
                <Select
                  disabled={selectedConversation !== ""}
                  onChange={(event) =>
                    setMode(event.target.value as SourceMode)
                  }
                  value={activeMode}
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
                disabled={preparing || busyAction !== ""}
                loading={busyAction === "index"}
                onClick={() => void buildIndex()}
                variant="secondary"
              >
                Prepare tender search
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
            <div className="chat-canvas__status-row">
              <Badge tone={currentIndexTone}>
                {currentIndex === null
                  ? "Search not prepared"
                  : `${humanizeEnum(currentIndex.status)} (${currentIndex.progressPercentage}%)`}
              </Badge>
              <Badge tone="neutral">{humanizeEnum(activeMode)}</Badge>
            </div>
          </details>
        ) : null}

        <div className="chat-canvas__messages">
          {detail === null && selectedConversation === "" ? (
            streamlined ? (
              <div className="chat-empty-state">
                <h2>How can I help?</h2>
                <p>
                  Ask about eligibility, missing evidence, risks, or your
                  proposal draft.
                </p>
              </div>
            ) : (
              <EmptyState
                description="Explore eligibility requirements, missing evidence, risks, and drafting questions."
                title="Ask about this tender"
              />
            )
          ) : pairedMessages.length === 0 ? (
            <EmptyState
              description="Ask a tender question to start a cited conversation."
              title="Conversation ready"
            />
          ) : (
            pairedMessages.map(({ answerRun, message, questionRun }) => (
              <Fragment key={message.id}>
                {message.role === "USER" ? (
                  <article className="chat-message chat-message--user">
                    <div className="chat-message__meta">
                      <strong>You</strong>
                    </div>
                    <p>{withoutDiagnosticSuffix(message.content)}</p>
                  </article>
                ) : answerRun !== null ? (
                  <AssistantResponse
                    answer={withoutDiagnosticSuffix(message.content)}
                    onRetry={() => void retryAnswer(answerRun.id)}
                    onShowSuggestions={() =>
                      document
                        .getElementById("chat-suggestions")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        })
                    }
                    run={answerRun}
                    tenderFilesHref={tenderFilesHref}
                  />
                ) : (
                  <article className="chat-message chat-message--assistant">
                    <div className="chat-message__meta">
                      <strong>Tender Intelligence</strong>
                    </div>
                    <p>{withoutDiagnosticSuffix(message.content)}</p>
                  </article>
                )}
                {message.role === "USER" &&
                questionRun !== null &&
                questionRun.answerMessageId == null ? (
                  <AssistantResponse
                    onRetry={() => void retryAnswer(questionRun.id)}
                    onShowSuggestions={() =>
                      document
                        .getElementById("chat-suggestions")
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        })
                    }
                    run={questionRun}
                    tenderFilesHref={tenderFilesHref}
                  />
                ) : null}
              </Fragment>
            ))
          )}
        </div>

        {!streamlined ? (
          <div className="chat-suggestions" id="chat-suggestions">
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
        ) : null}

        <form className="chat-composer" onSubmit={(event) => void ask(event)}>
          <Textarea
            aria-label="Ask about this tender"
            aria-describedby={
              !searchReady ? "chat-readiness-reason" : undefined
            }
            maxLength={2_000}
            onChange={(event) => setComposer(event.target.value)}
            placeholder={
              streamlined
                ? "Ask about this tender..."
                : "Ask about this tender?"
            }
            rows={2}
            value={composer}
          />
          <div className="chat-composer__actions">
            <span aria-live="polite" className="chat-composer__status">
              {busyAction === "index" || indexFailure || preparing
                ? ""
                : status}
            </span>
            <Button
              disabled={
                !searchReady || composer.trim() === "" || busyAction !== ""
              }
              loading={busyAction === "ask"}
              type="submit"
            >
              Send message
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
