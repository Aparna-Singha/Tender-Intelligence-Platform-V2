# ADR 0011: Immutable Source-Grounded Checklists

- Status: Accepted
- Date: 2026-07-29

## Context

Unresolved evidence assessments need actionable work without turning a checklist
generator into a second eligibility engine. Consolidation and human edits must not
destroy the original proposal or its exact Phase 7 provenance.

## Decision

Persist immutable checklist-generation runs against the active Phase 7 run and
evidence snapshot. Apply a deterministic, versioned policy in the existing BullMQ
worker. Store proposed fields separately from human-controlled fields, retain
relational assessment, requirement, and citation links, deduplicate conservatively,
and append every human workflow change to history. PostgreSQL remains authoritative;
Redis transports opaque identifiers only.

An upload cannot resolve an item. Resolution normally requires current Phase 7
provenance showing that the linked gap has left its unresolved state. Source changes
invalidate current results without deleting history.

## Consequences

Checklist work is reproducible, tenant-scoped, and auditable, and does not claim
eligibility. Users must return to Phase 7 to create or review evidence and then
reassess. Policy changes require a fresh generation. RAG, drafting, final readiness,
export, scraping, submission, and external reminders remain separate phases.

## Alternatives considered

- Mutable task rows were rejected because they erase machine provenance.
- Generating directly from filenames or document categories was rejected because
  file existence does not establish content.
- Automatically carrying resolved or dismissed state was rejected because new
  authoritative inputs require reconsideration.
