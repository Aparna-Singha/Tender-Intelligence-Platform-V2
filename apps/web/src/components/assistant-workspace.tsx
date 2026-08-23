"use client";

import {
  Bot,
  FileCheck2,
  Files,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type JSX } from "react";
import { Badge, Button, Card, EmptyState, Textarea } from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { assistantHref } from "../lib/assistant";
import { describeTender, type TenderSummary } from "./tender-presentation";

interface AssistantAction {
  readonly href: string;
  readonly label: string;
  readonly supportingText: string;
}

interface AssistantMessage {
  readonly actions?: readonly AssistantAction[];
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly text: string;
}

const starterPrompts = [
  "Where should I upload this file?",
  "What can I do from here without tender evidence?",
  "How do I get to tender AI Chat?",
] as const;

function initialAssistantMessage(organisationId: string): AssistantMessage {
  return {
    actions: [
      {
        href: "/dashboard",
        label: "Open dashboard",
        supportingText: "See current work across the organisation.",
      },
      {
        href: `/documents/${organisationId}`,
        label: "Open Company Docs",
        supportingText: "Upload reusable organisation evidence.",
      },
      {
        href: `/tenders/${organisationId}`,
        label: "Browse tenders",
        supportingText:
          "Pick the exact tender before asking evidence questions.",
      },
    ],
    id: "assistant-intro",
    role: "assistant",
    text: "I can help with workspace navigation and next-step guidance. Tender-grounded questions stay inside each tender's AI Chat, because this assistant does not mix evidence across tenders.",
  };
}

function buildAssistantReply(
  organisationId: string,
  prompt: string,
  tenders: readonly TenderSummary[],
): AssistantMessage {
  const normalized = prompt.trim().toLowerCase();
  const tenderChatActions = tenders.slice(0, 3).map((tender) => ({
    href: `/tenders/${organisationId}/${tender.id}?stage=ask`,
    label: tender.title,
    supportingText: "Open tender AI Chat",
  }));

  if (
    normalized.includes("upload") ||
    normalized.includes("file") ||
    normalized.includes("document")
  ) {
    return {
      actions: [
        {
          href: `/documents/${organisationId}`,
          label: "Company Docs",
          supportingText: "Reusable certificates and company evidence.",
        },
        {
          href: `/tenders/${organisationId}`,
          label: "Tender Files",
          supportingText: "Source documents stay inside the tender workspace.",
        },
      ],
      id: crypto.randomUUID(),
      role: "assistant",
      text: "Use Company Docs for reusable organisation evidence and Tender Files inside the exact tender for source uploads. Direct uploads stay private and signed, and tender analysis starts only from the tender workspace flow.",
    };
  }

  if (
    normalized.includes("eligibility") ||
    normalized.includes("requirement") ||
    normalized.includes("checklist")
  ) {
    return {
      actions: [
        {
          href: `/tenders/${organisationId}`,
          label: "Browse tenders",
          supportingText: "Open the relevant tender before reviewing evidence.",
        },
      ],
      id: crypto.randomUUID(),
      role: "assistant",
      text: "Eligibility stays tender-scoped. Open the relevant tender first, then use Overview and Eligibility to review extracted requirements, cited evidence, and any conflict or human-review state. I do not compare evidence across tenders here.",
    };
  }

  if (
    normalized.includes("draft") ||
    normalized.includes("proposal") ||
    normalized.includes("response")
  ) {
    return {
      actions: [
        {
          href: `/tenders/${organisationId}`,
          label: "Open tender workspaces",
          supportingText:
            "Drafting stays inside each tender after real prerequisites are met.",
        },
      ],
      id: crypto.randomUUID(),
      role: "assistant",
      text: "Drafting is still tender-scoped. Open the specific tender to check whether analysis, decision, and eligibility prerequisites are satisfied before drafting becomes available.",
    };
  }

  if (
    normalized.includes("chat") ||
    normalized.includes("ask") ||
    normalized.includes("rag") ||
    normalized.includes("citation")
  ) {
    return {
      actions:
        tenderChatActions.length === 0
          ? [
              {
                href: `/tenders/${organisationId}`,
                label: "Create or open a tender",
                supportingText:
                  "Tender AI Chat appears inside a tender workspace.",
              },
            ]
          : tenderChatActions,
      id: crypto.randomUUID(),
      role: "assistant",
      text: "Tender questions belong in tender AI Chat, where retrieval, citations, and source mode stay tied to one authorised tender and version. This global assistant does not answer tender-content questions without that scope.",
    };
  }

  return {
    actions: [
      {
        href: assistantHref(organisationId),
        label: "Stay here",
        supportingText: "Use this assistant for workspace guidance only.",
      },
      {
        href: "/dashboard",
        label: "Open dashboard",
        supportingText: "See current priorities and active workflow state.",
      },
      {
        href: `/tenders/${organisationId}`,
        label: "Browse tenders",
        supportingText: "Choose the exact tender before using tender AI Chat.",
      },
    ],
    id: crypto.randomUUID(),
    role: "assistant",
    text: "I can help with workspace navigation, upload guidance, and where to continue next. I do not answer tender-content questions here because this assistant has no cross-tender evidence context.",
  };
}

export function AssistantWorkspace({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const [message, setMessage] = useState("Loading workspace context...");
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [messages, setMessages] = useState<readonly AssistantMessage[]>([
    initialAssistantMessage(organisationId),
  ]);

  useEffect(() => {
    void apiRequest<readonly TenderSummary[]>(
      `/organisations/${organisationId}/tenders`,
    )
      .then((loaded) => {
        setTenders(loaded);
        setMessage("");
      })
      .catch((caught) =>
        setMessage(
          formatApiError(
            caught,
            "Assistant context could not be loaded right now.",
          ),
        ),
      );
  }, [organisationId]);

  const recentDrafts = useMemo(
    () =>
      tenders.filter((tender) => describeTender(tender).isDraft).slice(0, 3),
    [tenders],
  );

  const recentTenderChats = useMemo(() => tenders.slice(0, 4), [tenders]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const prompt = draft.trim();
    if (prompt === "" || submitting) return;
    setSubmitting(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: prompt },
      buildAssistantReply(organisationId, prompt, tenders),
    ]);
    setDraft("");
    setSubmitting(false);
  }

  function usePrompt(prompt: string): void {
    setDraft(prompt);
  }

  return (
    <div className="workspace-page">
      <header className="workspace-page__header">
        <div>
          <h1>AI Assistant</h1>
          <p>
            Organisation-scoped workspace guidance. Tender-grounded answers stay
            inside tender AI Chat.
          </p>
        </div>
      </header>

      <div className="workspace-card chat-workspace assistant-workspace">
        <aside className="chat-rail">
          <div className="chat-rail__identity">
            <span className="workspace-sidebar__brand-mark" aria-hidden="true">
              AI
            </span>
            <div>
              <strong>AI Assistant</strong>
              <small>Workspace guidance only</small>
            </div>
          </div>

          <div className="chat-rail__group">
            <div className="chat-rail__group-header">
              <strong>Quick prompts</strong>
              <small>
                Deterministic guidance without tender evidence access.
              </small>
            </div>
            <div className="chat-rail__shortcuts">
              {starterPrompts.map((prompt) => (
                <button
                  className="chat-rail__shortcut"
                  key={prompt}
                  onClick={() => usePrompt(prompt)}
                  type="button"
                >
                  <Sparkles aria-hidden="true" size={14} />
                  <span>{prompt}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="chat-rail__group">
            <div className="chat-rail__group-header">
              <strong>Tender chats</strong>
              <small>Open a tender before asking evidence questions.</small>
            </div>
            <div className="chat-rail__list">
              {recentTenderChats.length === 0 ? (
                <span className="chat-rail__shortcut chat-rail__shortcut--disabled">
                  <MessageSquare aria-hidden="true" size={14} />
                  <span>No tender chats yet</span>
                </span>
              ) : (
                recentTenderChats.map((tender) => (
                  <Link
                    className="chat-rail__shortcut"
                    href={`/tenders/${organisationId}/${tender.id}?stage=ask`}
                    key={tender.id}
                  >
                    <MessageSquare aria-hidden="true" size={14} />
                    <span>{tender.title}</span>
                  </Link>
                ))
              )}
            </div>
          </div>

          <div className="chat-rail__footer">
            <Link className="chat-rail__shortcut" href="/dashboard">
              <LayoutDashboard aria-hidden="true" size={14} />
              <span>Open dashboard</span>
            </Link>
            <Link
              className="chat-rail__shortcut"
              href={`/documents/${organisationId}`}
            >
              <FileCheck2 aria-hidden="true" size={14} />
              <span>Open Company Docs</span>
            </Link>
            <Link
              className="chat-rail__shortcut"
              href={`/tenders/${organisationId}`}
            >
              <Files aria-hidden="true" size={14} />
              <span>Browse tenders</span>
            </Link>
          </div>
        </aside>

        <section className="chat-canvas">
          <div className="chat-canvas__header">
            <div>
              <span className="chat-canvas__context">
                <Bot aria-hidden="true" size={14} />
                <strong>Organisation-scoped guidance</strong>
              </span>
              <h2>Workspace assistant</h2>
              <p className="chat-canvas__status-note">
                This assistant helps you navigate the product. It does not
                answer tender-content questions without an explicit tender
                scope.
              </p>
            </div>
            <Badge tone="warning">No cross-tender evidence mode</Badge>
          </div>

          <div className="chat-canvas__status-row">
            <span className="chat-canvas__status-note" aria-live="polite">
              {message === "" ? "Ready for workspace guidance." : message}
            </span>
            <span className="chat-canvas__status-note">
              Recent drafts: {recentDrafts.length}
            </span>
          </div>

          <div className="chat-canvas__messages">
            {messages.length === 0 ? (
              <Card>
                <EmptyState
                  description="Ask for workspace guidance, upload routing, or where to continue next."
                  title="No assistant messages yet"
                />
              </Card>
            ) : (
              messages.map((entry) => (
                <article
                  className={`chat-message chat-message--${entry.role === "user" ? "user" : "assistant"}`}
                  key={entry.id}
                >
                  <div className="chat-message__meta">
                    <strong>
                      {entry.role === "user" ? "You" : "AI Assistant"}
                    </strong>
                    <small>
                      {entry.role === "user"
                        ? "Your prompt"
                        : "Deterministic workspace guidance"}
                    </small>
                  </div>
                  <p>{entry.text}</p>
                  {entry.actions?.length ? (
                    <div className="assistant-actions">
                      {entry.actions.map((action) => (
                        <Link
                          className="assistant-actions__link"
                          href={action.href}
                          key={`${entry.id}-${action.href}`}
                        >
                          <span>{action.label}</span>
                          <small>{action.supportingText}</small>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <form
            className="chat-composer"
            onSubmit={(event) => void submit(event)}
          >
            <label className="chat-composer__field">
              <span className="visually-hidden">Ask the AI Assistant</span>
              <Textarea
                aria-label="Ask the AI Assistant"
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask for workspace guidance, upload routing, or the next safe place to continue."
                rows={4}
                value={draft}
              />
            </label>
            <div className="chat-composer__actions">
              <span className="chat-canvas__status-note">
                Tender-grounded answers remain in tender AI Chat.
              </span>
              <Button loading={submitting} type="submit">
                Get guidance
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
