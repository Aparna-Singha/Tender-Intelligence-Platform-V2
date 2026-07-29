# Retrieval-Augmented Generation Policy

## Purpose

Tender-scoped retrieval-augmented generation (RAG) helps authorized users ask
questions about a tender and prepare traceable work products. It is an evidence
interface, not an unrestricted chatbot or a source of legal advice.

## Allowed sources

A tender conversation may retrieve only:

- the selected tender's accepted document versions, annexures, and corrigenda;
- approved company evidence belonging to the same organisation when the operation
  explicitly requires it;
- manually entered metadata with visible provenance;
- approved system policy content.

Demonstration fixtures are isolated and clearly labelled. General model knowledge,
another tender, another organisation, the public internet, and unapproved company
claims are not evidence for tender-specific answers.

## Ingestion requirements

Only files that pass authorization, validation, malware scanning, and processing
policy enter the retrieval index. Extraction preserves organisation, tender,
document, version, page, clause where available, and stable source coordinates.

Chunks should follow document structure with bounded overlap. Tables and clauses
require layout-aware handling. Embeddings and full-text indexes are derived,
versioned, access-controlled, and rebuildable from authoritative records.

## Retrieval policy

1. Authorize the actor, organisation, tender, and requested source classes.
2. Apply hard metadata filters before similarity or full-text ranking.
3. Retrieve using PostgreSQL full-text search and pgvector initially.
4. Prefer current accepted versions while retaining explicit corrigendum context.
5. Rerank or expand context only within the authorized source set.
6. Enforce a bounded context and record retrieval provenance.
7. Return insufficient-evidence status when the corpus does not support an answer.

Tenant and tender filters cannot be delegated to the model or applied only after
retrieval.

## Answer policy

Answers must:

- distinguish tender statements, company evidence, inference, and human decisions;
- cite every important tender finding with document, page, and clause;
- link company claims to approved evidence when used;
- state material uncertainty and conflicts;
- refuse unsupported questions rather than inventing an answer;
- avoid silently resolving legal, regulatory, eligibility, or compliance ambiguity;
- remind users that final high-stakes decisions remain human-controlled.

If extraction cannot establish a reliable page or clause, the assistant must say so
and request human review. Citations are verified against the cited source version
before display.

## Prompt-injection resistance

Retrieved documents and user-supplied metadata are untrusted content. Instructions
inside them cannot override system policy, expand retrieval scope, reveal secrets,
invoke unauthorized tools, or suppress citations. Suspicious passages are retained
as evidence when relevant but isolated from control instructions and surfaced for
review.

The model receives minimum necessary context and no raw credentials. Tool results
are validated. Model-proposed identifiers are never trusted for authorization.

## Drafting policy

Drafts use only cited tender requirements, approved company facts, and explicit
human-provided instructions. Unknown values remain clearly marked for completion.
Generated text is versioned, identifies source inputs and model configuration, and
requires human review. AI output cannot approve itself.

## Evaluation and release gates

Before release, a representative, non-private evaluation set must measure:

- citation presence and citation correctness;
- answer faithfulness and unsupported-claim rate;
- refusal of unanswerable questions;
- organisation and tender isolation;
- corrigendum and conflicting-source handling;
- prompt-injection resistance;
- retrieval recall for material clauses;
- latency and failure behavior.

Thresholds for the first milestone are in
[Acceptance Criteria](ACCEPTANCE_CRITERIA.md). Evaluation failures block release;
provider changes require regression evaluation.

## Privacy, retention, and providers

Prompts and retrieved text are sent only to an approved provider configuration.
Provider training use must be disabled where contractually supported, and retention,
location, subprocessors, and deletion behavior must be reviewed before production.
Sensitive prompt and response bodies are not logged by default.

Conversation, retrieval, and model-call records follow documented retention and
deletion rules, including derived chunks and embeddings.

Phase 7 does not implement retrieval or a chatbot. Its reviewed, versioned company
facts and exact citations are designed as possible future Phase 9 inputs, but Phase
9 must independently re-authorise the organisation and consume only current,
approved evidence. Assessment state alone is not retrieval evidence.

## Phase 9 implementation contract

Phase 9 uses `structure-aware-v1`, `hybrid-rrf-v1`, and
`cited-human-controlled-v1`. The default is `TENDER_ONLY`. Company evidence
requires an explicit source mode and `RAG_COMPANY_EVIDENCE_USE`.

PostgreSQL applies organisation, tender, tender-version, active-index, and
source-class predicates before ranking. Full-text and 768-dimensional cosine ranks
are fused using versioned reciprocal-rank fusion. Limits are 2,000 question
characters, 4,000 chunk characters, about 1,000 chunk tokens, 16 embeddings per
batch, 40 candidates, 8 context passages, and 1,200 answer tokens.

Every follow-up performs fresh retrieval; conversation history is not evidence.
The provider receives application-issued handles only. Unknown handles or
unsupported material claims fail closed.

Gemini is the first adapter behind provider-neutral ports. Missing configuration,
timeout, invalid schema, or invented citations create no fallback answer.
Production remains blocked until provider retention, training use, residency,
subprocessors, and deletion terms are approved. There is no internet retrieval,
tool use, legal advice, drafting, readiness, export, scraping, or submission.
