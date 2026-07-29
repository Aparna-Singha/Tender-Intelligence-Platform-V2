# ADR 0010: Immutable Controlled Evidence Assessments

- Status: Accepted
- Date: 2026-07-29

## Context

Company profiles and documents change, while eligibility conclusions are
high-stakes and must remain reproducible. Secure storage alone does not provide
citation-preserving facts from company documents.

## Decision

Phase 7 uses PostgreSQL relational snapshots and immutable assessment runs.
Manually captured, typed company facts have immutable versions and exact
human-captured citations to approved document versions. A deterministic,
versioned domain policy creates conservative proposals. Human decisions are
append-only and separate from proposals; only authorised reviewers may finalise
`VERIFIED`, `NOT_APPLICABLE`, or conflict dispositions.

BullMQ transports opaque run identifiers. PostgreSQL remains authoritative.
Authoritative input changes invalidate active results without deleting history.

## Consequences

Assessment history is auditable and tenant-scoped, and document existence cannot
be mistaken for content proof. Users must manually capture evidence from scanned
or otherwise unparsed company documents until a citation-preserving extraction
adapter exists. Phase 8 checklist and Phase 9 RAG remain separate.
