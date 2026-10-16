"use client";

import { useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { Button, Textarea } from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";

export interface SavedConversation {
  readonly id: string;
  readonly title: string | null;
  readonly tenderId: string | null;
  readonly tenderVersionId: string | null;
  readonly pinned: boolean;
  readonly updatedAt: string;
  readonly context?: string | null;
}
interface Transcript extends SavedConversation {
  readonly messages: readonly {
    id: string;
    role: "USER" | "ASSISTANT";
    content: string;
  }[];
}

export function WorkspaceConversation({
  organisationId,
  initialConversationId,
  context = "Workspace",
  onConversationChange,
  compact = false,
}: {
  readonly organisationId: string;
  readonly initialConversationId?: string;
  readonly context?: string;
  readonly onConversationChange: (id: string) => void;
  readonly compact?: boolean;
}): JSX.Element {
  const [id, setId] = useState(initialConversationId ?? "");
  const [detail, setDetail] = useState<Transcript | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const history = useRef<HTMLDivElement>(null);
  const sendLock = useRef(false);
  const base = `/organisations/${organisationId}/conversations`;
  useEffect(() => {
    if (id === "") return;
    let active = true;
    void apiRequest<Transcript>(`${base}/${id}`)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((caught) => {
        if (active)
          setError(formatApiError(caught, "Conversation could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [base, id]);
  useEffect(() => {
    if (history.current !== null)
      history.current.scrollTop = history.current.scrollHeight;
  }, [detail]);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (sendLock.current || draft.trim() === "") return;
    sendLock.current = true;
    setBusy(true);
    setError("");
    try {
      let selected = id;
      if (selected === "") {
        const created = await apiRequest<SavedConversation>(base, {
          method: "POST",
          body: JSON.stringify({ context }),
        });
        selected = created.id;
        setId(selected);
      }
      const result = await apiRequest<Transcript>(
        `${base}/${selected}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            question: draft.trim(),
            idempotency_key: crypto.randomUUID(),
          }),
        },
      );
      setDetail(result);
      setDraft("");
      window.dispatchEvent(new Event("conversations-changed"));
      onConversationChange(selected);
    } catch (caught) {
      setError(
        formatApiError(caught, "Message could not be saved. Try again."),
      );
    } finally {
      setBusy(false);
      sendLock.current = false;
    }
  }
  return (
    <section className="chat-canvas">
      {!compact ? (
        <header className="chat-canvas__header">
          <div>
            <small>{context}</small>
            <h2>{detail?.title ?? "New conversation"}</h2>
            <p className="chat-canvas__status-note">
              Answers from current workspace records.
            </p>
          </div>
        </header>
      ) : null}
      <div className="chat-canvas__messages" ref={history} aria-live="polite">
        {detail?.messages.length ? (
          detail.messages.map((message) => (
            <article
              className={`chat-message chat-message--${message.role.toLowerCase()}`}
              key={message.id}
            >
              <strong>
                {message.role === "USER" ? "You" : "AI Assistant"}
              </strong>
              <p>{message.content}</p>
            </article>
          ))
        ) : (
          <div className="chat-empty-state">
            <h2>How can I help?</h2>
            <p>
              Ask about your workspace, tender pipeline, or where to find a
              setting.
            </p>
          </div>
        )}
      </div>
      <form className="chat-composer" onSubmit={(event) => void send(event)}>
        {error ? <p role="alert">{error}</p> : null}
        <Textarea
          aria-label={compact ? "Ask AI Assistant" : "Ask Tender Intelligence"}
          rows={2}
          maxLength={2000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about your workspace..."
        />
        <div className="chat-composer__actions">
          <span />
          <Button type="submit" disabled={busy || !draft.trim()} loading={busy}>
            Send message
          </Button>
        </div>
      </form>
    </section>
  );
}
