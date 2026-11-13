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

The answer query keeps score ties as ties when calculating reciprocal ranks.
Deterministic row positions, with chunk ID as the final tie breaker, bound the
lexical and vector candidate sets separately. The final eight passages are
ordered by fused relevance, without reserving prompt slots for metadata or
structured fields. Source classes still pass the mode allowlist inside the
tenant-scoped SQL query; the model receives only those eight selected passages.

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

## Retrieval ranking correction and verification

The earlier answer query put tender metadata and every structured field ahead
of all document and requirement chunks, regardless of their scores. In a
read-only staging diagnosis of one synthetic tender, the current index had 33
embedded/searchable chunks (15 primary, 13 requirements, three fields, one
metadata, one policy). Each of 12 recent answer runs supplied metadata and all
three fields before other sources. Four runs returned insufficient evidence
after answer generation; one summary run completed. The aggregate diagnosis
does not establish whether a particular private clause was present or selected.

An isolated disposable PostgreSQL 18/pgvector fixture runs the worker's exact
parameterized retrieval query against the same 33-chunk class distribution and
independently labeled synthetic questions. Relevant-passage recall at eight
changed from 3 to 8 for document uploads, 1 to 8 for eligibility, and 4 to 8
for disqualification. A query-specific exemption requirement changed from
absent to selected. The summary kept its four relevant metadata/field passages;
an unsupported question still had zero relevant passages. All eight selected
document/requirement passages in the three detailed cases retained valid
synthetic citation identities. Scope, source-mode, duplicate, empty-result,
stale-index, and deterministic-order checks passed. Repeated local EXPLAIN
ANALYZE medians for the actual document query were 0.280/0.264 ms and
0.294/0.394 ms (before/after); the small differences varied between runs and
are not Neon latency measurements.
The fixed SQL keeps a maximum of 40 candidate positions per retrieval channel
and eight prompt passages. No source, tenant, version, index, citation, or
currentness predicate was relaxed. Existing index rows and conversations remain
intact, and no live reindex is part of this correction. New retrieval records
use fusion policy `reciprocal-rank-fusion-v2`, distinguishing them from
historical v1 results without changing the index fingerprint.

Worker diagnostics record only fixed outcome categories and counts for selected
primary, requirement, field, metadata, and other passages. They exclude prompts,
passages, embeddings, source IDs, tender IDs, credentials, and provider responses.
Whether the four observed staging answers improve remains unverified until a
separately approved rollout and controlled validation; the synthetic fixture
cannot prove that the needed real clauses exist in the current index.

## Alternatives considered

- A separate vector database was rejected because it adds synchronization and
  tenant-isolation risk.
- Post-ranking tenant filtering was rejected because unauthorised passages could
  enter candidate sets.
- Model-generated source identifiers were rejected because they are not authority.
- General web search and autonomous tools were rejected as outside Phase 9.
