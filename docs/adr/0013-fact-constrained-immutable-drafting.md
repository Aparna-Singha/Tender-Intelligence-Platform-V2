# ADR 0013: Fact-Constrained Immutable Drafting

- Status: Accepted
- Date: 2026-07-29

## Context

Narrative generation can silently turn uncertain tender interpretation, stale
evidence, or model memory into apparently authoritative bid content. Phase 10 must
reuse the controlled Phase 5–9 records while preserving human responsibility and
must remain separate from readiness, export, and submission.

## Decision

Implement drafting inside the modular monolith with:

- a relational immutable snapshot of exact current Phase 5–9 inputs and policy,
  template, retrieval, provider, and model versions;
- a provider-neutral drafting port with Gemini as the first adapter;
- hard-filtered, bounded per-section retrieval from the active Phase 9 index;
- structured claims, citations, visible placeholders, and typed reviewed human
  inputs in PostgreSQL;
- immutable generated and edited versions with append-oriented review events;
- fail-closed source revalidation and invalidation;
- human-only approval with permission, rationale, blocker checks, and separation of
  duties.

RAG answers and conversation history are not evidence. Redis remains
non-authoritative. No model or worker can approve, export, submit, browse, or change
permissions.

## Consequences

Drafts remain traceable to exact inputs and cannot silently hide unsupported
content. Revisions and changed sources require new review. More rows and validation
queries are accepted in exchange for auditability. Phase 10 provides no final
readiness decision or buyer-ready artifact.

## Alternatives

- Free-form generation was rejected because it cannot provide claim-level support.
- Storing one draft JSON blob was rejected because provenance and review transitions
  would be unqueryable.
- Treating chat answers as evidence was rejected because answers are derived and
  may be stale.
- Overwriting drafts was rejected because it destroys history and approval context.
- A second Gemini integration was rejected in favour of the existing gateway.

## Follow-up constraints

Phase 11 may consume only a current human-approved version and must perform its own
final readiness and second risk analysis. Phase 12 export remains a separate,
authorised decision. Production provider privacy and regional-processing approval,
provider-backed quality evaluation, and an approved deletion schedule remain
release gates.
