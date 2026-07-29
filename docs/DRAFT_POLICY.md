# Fact-Constrained Draft Policy

## Scope

Phase 10 produces structured, reviewable tender-response drafts. It does not make
an eligibility or readiness decision, perform the second risk analysis, export a
review package, browse public sources, scrape portals, give legal advice, price a
bid, or submit one. Approval means only “human-approved draft version for final
readiness review.”

## Start gate and authority

The API starts an asynchronous run only for the authenticated organisation and
tender when all of these exact inputs are current:

- active completed Phase 5 extraction;
- completed current Phase 6 `EARLY` risk analysis and unsuperseded human
  `CONTINUE`;
- completed current Phase 7 assessment and its relational evidence snapshot;
- completed current Phase 8 checklist generation;
- active completed Phase 9 index matching the tender version, extraction, and
  authorised source mode;
- configured Gemini narrative provider behind the provider-neutral gateway.

The API records the IDs, source checksums, model, template, prompt, retrieval, and
drafting policy versions in an immutable relational snapshot. Jobs contain opaque
run and organisation IDs. The worker reloads authority before work and immediately
before persistence. Redis transports work but never owns draft state.

RAG conversations, messages, and answers are excluded. A retrieval hit may only
lead back to its authoritative tender or approved company source.

## Claims and citations

Every generated bounded claim is classified as a tender statement, approved
company fact, human commitment, derived assessment, risk/checklist warning,
review-required inference, or placeholder. Material statements require verified
application-issued citation handles.

Company assertions additionally require an accepted, current evidence-fact version
and valid exact evidence citation. A filename, category, checklist item,
`LIKELY_MET` assessment, self-declaration, or model memory is never proof.
Conflicts and unsupported content stay visible and block approval.

Retrieved and user-provided text is inert data. Provider output is strict JSON,
untrusted until schema, handle, tenant, source-version, and claim-policy validation
passes. Provider errors fail explicitly; there is no fabricated fallback.

## Templates and planning

Templates and template versions are separate records. Versions define stable,
ordered section keys, headings, allowed claim classes, required source classes,
review role, and bounded formatting guidance. Scripts, remote URLs, includes, and
executable guidance are rejected. The deterministic planner does not decide
eligibility.

## Placeholders and human input

Missing evidence, conflict, technical or commercial input, signatory input,
clarification, expired evidence, unsupported commitments, and human review are
represented with visible `[[REVIEW REQUIRED: ...]]` markers. Material placeholders
block approval. Typing over a marker creates a new version but does not resolve the
placeholder. Resolution requires a current valid evidence citation or an
authorised reviewed human input, an actor, and rationale; it can be reopened.

Human inputs are typed, bounded records with provenance and review history. Writing
preferences control presentation only. They are not facts. Commitment-bearing
inputs require independent review and do not become company evidence.

## Versioning, review, and invalidation

Generated and edited versions are immutable. Editing creates a child version,
clears approval, resets review, preserves source provenance, and adds an
approval-blocking validation placeholder to every changed section. Version
comparison returns text, claims, citations, placeholders, source versions, and
review state.

Review events are append-oriented and audit the actor and rationale. Only a user
with the approval permission may approve; the creator cannot self-approve. Current
source versions, valid cited material claims, reviewed commitments, resolved
conflicts, and zero blocking placeholders are mandatory. Models and workers have
no approval capability.

Reads and review operations re-evaluate authoritative inputs. An affected version
and its run become `INVALIDATED`, any approval is cleared, and the historical
record remains readable. Regeneration or editing requires fresh review. This
application-level invalidation is fail-closed; future phases may add event-driven
eager propagation without changing the policy.

## Bounds and operations

- instructions: 2,000 characters;
- human input: 4,000 characters;
- section: 12,000 characters;
- sections/template: 40;
- generated claims/section: 80;
- retrieved contexts/section: 8;
- provider output/section: 2,400 tokens;
- captured snapshot sources: 5,000;
- API page size: 100;
- SSE connection: five minutes;
- worker timeout: `DRAFT_JOB_TIMEOUT_MS` (default 300,000 ms);
- queue concurrency: shared worker concurrency, default two.

Generation records planning, retrieval, generation, validation, and total latency.
Logs, queue bodies, audit metadata, and SSE exclude source bodies, prompts,
credentials, object keys, and draft text.

## Retention

Archive hides a draft from active work without destroying history. Drafts carry
retention and deletion fields, but physical deletion is deliberately unavailable
until an approved retention schedule and cascade procedure exist. Phase 10 does not
render or store PDF/DOCX output.
