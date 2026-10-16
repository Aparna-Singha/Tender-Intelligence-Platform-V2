# Shared chat persistence and RAG repair

## Decision

Extend `RagConversation` and `RagMessage`; do not introduce a separate popup
history or Project table. Tender conversations retain their version, index,
answer runs and verified citations. Workspace conversations have no tender,
version or index. Project groups are derived from `tenderId`.

The browser creates a conversation on first Send, saves messages automatically,
and uses the returned conversation ID for subsequent messages and deep links.
Closing the contextual popup retains its mounted session. Reloading full chat
loads the transcript from PostgreSQL. Neither transcripts nor pins use localStorage.

Workspace responses are deterministic summaries of current organisation tender
records and navigation guidance. They are not general-purpose model answers or
tender interpretations. Unsupported questions receive an explicit refusal.

## API

All routes below are under `/organisations/{organisationId}/conversations`.
They use the existing session, CSRF, organisation permission and rate-limit guards.
The API's generated `/openapi` document includes the new controller and bodies.

| Operation             | Request                                | Result                                                |
| --------------------- | -------------------------------------- | ----------------------------------------------------- |
| GET collection        | None                                   | Up to 100 active conversations, newest activity first |
| POST collection       | Optional `context` (160 characters)    | Workspace conversation                                |
| GET `/{id}`           | UUID                                   | Conversation, ordered messages and cited answer runs  |
| PATCH `/{id}`         | Optional `title`, `pinned`, `archived` | Updated conversation                                  |
| POST `/{id}/messages` | `question`, `idempotency_key`          | Saved workspace transcript                            |

Read/create/send/update use the existing `RAG_CONVERSATION_READ`,
`RAG_CONVERSATION_CREATE`, `RAG_QUESTION_ASK` and
`RAG_CONVERSATION_ARCHIVE` permissions respectively. Each database lookup repeats
organisation scoping. Workspace sends cannot bypass the tender question endpoint.
Row locking serializes message sequence allocation. Workspace message retries
with the same key do not duplicate the message pair.

Tender creation and sends retain the existing tender-scoped RAG endpoints.
Sending the first question derives a bounded title; later activity updates
`updatedAt`. The shared PATCH route persists pins for either conversation kind.

## RAG repairs

- Index retries remain separate immutable runs. The source-fingerprint uniqueness
  constraint prevented a retry after failure. A lookup index replaces it;
  the unique request idempotency key remains.
- Answer finalization requires `VERIFYING_CITATIONS`, the state actually reached
  after verification, rather than the earlier `GENERATING` state. Cancellation,
  current-index and tenant checks remain.
- A retry upserts the retrieval record for its answer and replaces its derived
  hits. The one-retrieval-per-answer constraint remains.
- Assistant messages retain answer-run linkage and page/clause/excerpt citations.
  The UI associates citations by `answerMessageId`, not by array position.
- The configured Gemini 2.5 Flash RAG request disables dynamic thinking within
  the existing 1,200-token JSON output budget. A real request previously spent
  1,151 tokens thinking and returned only 35 response tokens with `MAX_TOKENS`.
  Truncated responses fail closed. See Google's
  [thinking configuration documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking).
- Unexpected internal errors are persisted as `RAG_PROCESSING_FAILED`, not raw
  database exception text.

## Migration and recovery

`20260919000100_shared_conversations` is non-destructive and was applied to the
local database without a reset. It adds nullable workspace associations, pin and
context fields, and a message retry key. Existing tender transcripts and citation
relations remain intact. An all-or-none check protects tender associations; an
additional organisation/conversation foreign key protects workspace messages
even when the tender key is null.

Prefer a forward repair if deployment fails. The previous tender-only application
can continue reading tender-associated rows with these additive columns present.
Do not reinstate NOT NULL constraints or drop workspace rows to roll back: retain
workspace data and temporarily disable workspace writes until a corrected release.
Do not reinstate fingerprint uniqueness while multiple valid index attempts exist.

## Local verification

The browser scripts under `apps/web/scripts/chat-*.mjs` use a short-lived local
session for an existing authorised member and revoke it on exit. They preserve
test conversations for refresh/history checks. They require the existing local
database, API, worker, Chromium and web server; they do not mock the RAG provider.
Run them only against the intended local development database.

API and worker logs used during repair are ignored `chat-live*.log` files.
The existing built worker start command has an unrelated `tesseract.js-core`
resolution problem in this checkout; the established `pnpm dev:worker` command
loads successfully. No extraction or OCR code was changed for this repair.
