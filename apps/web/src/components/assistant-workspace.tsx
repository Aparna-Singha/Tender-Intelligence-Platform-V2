"use client";

import { MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, type JSX } from "react";
import { Button, Input } from "@tender/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { RagChatbot } from "./rag-chatbot";
import {
  WorkspaceConversation,
  type SavedConversation,
} from "./workspace-conversation";
import type { TenderSummary } from "./tender-presentation";

export function AssistantWorkspace({
  organisationId,
}: {
  readonly organisationId: string;
}): JSX.Element {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get("conversation") ?? "new";
  const [chats, setChats] = useState<readonly SavedConversation[]>([]);
  const [tenders, setTenders] = useState<readonly TenderSummary[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const base = `/organisations/${organisationId}/conversations`;
  async function refresh(): Promise<void> {
    try {
      setChats(await apiRequest<readonly SavedConversation[]>(base));
      setError("");
    } catch (caught) {
      setError(formatApiError(caught, "Chats could not be loaded."));
    }
  }
  useEffect(() => {
    void refresh();
    void apiRequest<readonly TenderSummary[]>(
      `/organisations/${organisationId}/tenders`,
    )
      .then(setTenders)
      .catch(() => setError("Tender projects could not be loaded."));
    const listener = (): void => {
      void refresh();
    };
    window.addEventListener("conversations-changed", listener);
    const timer = window.setInterval(listener, 5000);
    return () => {
      window.removeEventListener("conversations-changed", listener);
      window.clearInterval(timer);
    };
  }, [base]);
  const active = chats.find((chat) => chat.id === selected);
  const titleFor = (chat: SavedConversation): string =>
    chat.title ?? "Untitled conversation";
  const tenderTitle = (id: string | null): string =>
    tenders.find((tender) => tender.id === id)?.title ?? "Workspace";
  const filtered = chats.filter((chat) =>
    `${titleFor(chat)} ${tenderTitle(chat.tenderId)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  function select(id: string): void {
    router.replace(
      `/assistant/${organisationId}?conversation=${encodeURIComponent(id)}`,
      { scroll: false },
    );
  }
  async function pin(chat: SavedConversation): Promise<void> {
    try {
      await apiRequest(`${base}/${chat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ pinned: !chat.pinned }),
      });
      await refresh();
      setOpenMenuId(null);
    } catch (caught) {
      setError(formatApiError(caught, "Pin could not be saved."));
    }
  }
  async function remove(chat: SavedConversation): Promise<void> {
    try {
      await apiRequest(`${base}/${chat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      setOpenMenuId(null);
      if (selected === chat.id) select("new");
      await refresh();
    } catch (caught) {
      setError(formatApiError(caught, "Chat could not be deleted."));
    }
  }
  function row(chat: SavedConversation, section: string): JSX.Element {
    const title = titleFor(chat);
    const menuKey = `${section}:${chat.id}`;
    const menuOpen = openMenuId === menuKey;
    return (
      <div
        className={`chat-rail__item ${selected === chat.id ? "chat-rail__item--active" : ""}`}
        key={menuKey}
      >
        <button
          type="button"
          className="chat-rail__item-button"
          onClick={() => select(chat.id)}
        >
          <span className="chat-rail__item-title">{title}</span>
        </button>
        <div
          className="chat-rail__item-menu"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setOpenMenuId(null);
            }
          }}
        >
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`Actions for ${title}`}
            className="chat-rail__menu-trigger"
            onClick={() => setOpenMenuId(menuOpen ? null : menuKey)}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" size={17} />
          </button>
          {menuOpen ? (
            <div
              aria-label={`Actions for ${title}`}
              className="chat-rail__menu-popover"
              role="menu"
            >
              <button
                onClick={() => void pin(chat)}
                role="menuitem"
                type="button"
              >
                {chat.pinned ? (
                  <PinOff aria-hidden="true" size={15} />
                ) : (
                  <Pin aria-hidden="true" size={15} />
                )}
                {chat.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                className="chat-rail__delete-action"
                onClick={() => void remove(chat)}
                role="menuitem"
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} />
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="workspace-page assistant-page">
      <header className="workspace-page__header">
        <h1>AI Chat</h1>
      </header>
      <div className="workspace-card chat-workspace assistant-workspace">
        <aside className="chat-rail" aria-label="Conversations">
          <Button onClick={() => select("new")} variant="secondary">
            + New chat
          </Button>
          <Input
            aria-label="Search chats"
            placeholder="Search chats"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {error ? <p role="alert">{error}</p> : null}
          <div className="chat-rail__scroll">
            <section className="chat-rail__group" aria-label="Workspace">
              <strong className="chat-rail__group-header">Workspace</strong>
              {filtered
                .filter((chat) => chat.tenderId === null)
                .map((chat) => row(chat, "workspace"))}
            </section>
            <section className="chat-rail__group" aria-label="Projects">
              <strong className="chat-rail__group-header">Projects</strong>
              {tenders.map((tender) => (
                <div className="chat-rail__project" key={tender.id}>
                  <Link href={`/tenders/${organisationId}/${tender.id}`}>
                    {tender.title}
                  </Link>
                  {filtered
                    .filter((chat) => chat.tenderId === tender.id)
                    .map((chat) => row(chat, `project:${tender.id}`))}
                </div>
              ))}
            </section>
            <section className="chat-rail__group" aria-label="Pinned">
              <strong className="chat-rail__group-header">Pinned</strong>
              {filtered
                .filter((chat) => chat.pinned)
                .map((chat) => row(chat, "pinned"))}
            </section>
            <section className="chat-rail__group" aria-label="Recent">
              <strong className="chat-rail__group-header">Recent</strong>
              {filtered.map((chat) => row(chat, "recent"))}
              {!filtered.length ? <p>No saved conversations yet.</p> : null}
            </section>
          </div>
        </aside>
        {selected !== "new" && active === undefined ? (
          <section className="chat-canvas">
            <p role="status">Loading conversation...</p>
          </section>
        ) : active?.tenderId && active.tenderVersionId ? (
          <RagChatbot
            key={selected}
            organisationId={organisationId}
            tenderId={active.tenderId}
            versionId={active.tenderVersionId}
            tenderTitle={tenderTitle(active.tenderId)}
            initialConversationId={selected}
            embedded
            onConversationChange={(id) => {
              void refresh();
              select(id);
            }}
          />
        ) : (
          <WorkspaceConversation
            key={`${organisationId}:${selected}`}
            organisationId={organisationId}
            {...(selected === "new" ? {} : { initialConversationId: selected })}
            onConversationChange={(id) => {
              void refresh();
              select(id);
            }}
          />
        )}
      </div>
    </div>
  );
}
