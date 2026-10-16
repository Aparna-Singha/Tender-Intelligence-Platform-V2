"use client";

import { ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type JSX } from "react";
import { Button } from "@tender/ui";
import { RagChatbot } from "./rag-chatbot";
import { WorkspaceConversation } from "./workspace-conversation";

export function ContextualAssistant({
  context,
  openInChatHref,
  organisationId,
  tenderId,
  versionId,
  contextLabel,
}: {
  readonly context: string;
  readonly contextLabel?: string;
  readonly openInChatHref: string;
  readonly organisationId: string;
  readonly tenderId?: string;
  readonly versionId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const [conversationId, setConversationId] = useState("");
  const [started, setStarted] = useState(false);
  const [path, query = ""] = openInChatHref.split("?");
  const params = new URLSearchParams(query);
  params.set("conversation", conversationId || "new");
  const destination = `${path}?${params.toString()}`;
  return (
    <>
      <button
        className="workspace-floating-ai"
        disabled={!interactive}
        onClick={() => {
          setOpen(true);
          setStarted(true);
        }}
        type="button"
      >
        <span aria-hidden="true">AI</span>Ask about {context}
      </button>
      {started ? (
        <aside
          aria-label="AI Assistant popup"
          className="contextual-assistant"
          style={open ? undefined : { display: "none" }}
        >
          <header>
            <div>
              <strong>AI Assistant</strong>
              <small>{contextLabel ?? context}</small>
            </div>
            <div>
              <Link aria-label="Open in AI Chat" href={destination}>
                <ExternalLink size={16} />
              </Link>
              <Button
                aria-label="Close AI Assistant"
                onClick={() => setOpen(false)}
                type="button"
                variant="quiet"
              >
                <X size={16} />
              </Button>
            </div>
          </header>
          {tenderId !== undefined && versionId !== undefined ? (
            <RagChatbot
              organisationId={organisationId}
              tenderId={tenderId}
              versionId={versionId}
              tenderTitle={contextLabel ?? context}
              compact
              embedded
              onConversationChange={setConversationId}
            />
          ) : tenderId !== undefined ? (
            <p role="status">
              A tender version is required to prepare tender search.
            </p>
          ) : (
            <WorkspaceConversation
              organisationId={organisationId}
              context={context}
              onConversationChange={setConversationId}
              compact
            />
          )}
        </aside>
      ) : null}
    </>
  );
}
