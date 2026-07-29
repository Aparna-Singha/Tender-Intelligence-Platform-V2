# ADR 0012: Tenant-Isolated Hybrid Tender Retrieval

- Status: Accepted
- Date: 2026-07-29

## Context

Phase 9 needs cited tender answers without creating a second source of truth,
trusting model memory, or permitting cross-tenant similarity search. Retrieval,
generation, and citation verification have different trust boundaries.

## Decision

Use immutable PostgreSQL RAG index runs over current Phase 5 extraction records.
Structure-aware chunks retain exact organisation, tender, version, extraction,
document, page, clause, coordinates, checksum, and source-class provenance. Hard
organisation, tender, tender-version, index-run, and source-class predicates execute
inside SQL before full-text or pgvector ranking. PostgreSQL full-text search and
768-dimensional pgvector cosine similarity are fused using versioned reciprocal
rank fusion.

Use provider-neutral embedding and answer gateways in the worker. Gemini is the
first HTTP adapter and is configured only through environment secrets. Missing
configuration fails with `PROVIDER_UNAVAILABLE`; there is no fake answer.

Each question creates a fresh retrieval record. Conversation history is display
context, not evidence. The model receives application-issued citation handles and
inert bounded passages. Application code validates every returned handle against
the exact retrieved chunks before persisting citations. Unsupported questions
produce an explicit insufficient-evidence state.

## Consequences

- PostgreSQL remains authoritative; indexes and embeddings are rebuildable.
- Company evidence requires an explicit source mode and permission.
- Index and answer history is reproducible and invalidated when authoritative
  source fingerprints change.
- Provider latency, availability, privacy terms, and regional processing remain
  production dependencies.
- HNSW improves vector search but requires operational tuning and measured recall.

## Alternatives considered

- A separate vector database was rejected because it adds synchronization and
  tenant-isolation risk.
- Post-ranking tenant filtering was rejected because unauthorised passages could
  enter candidate sets.
- Model-generated source identifiers were rejected because they are not authority.
- General web search and autonomous tools were rejected as outside Phase 9.
