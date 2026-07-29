# Missing Evidence and Action Checklist Policy

Policy version: `deterministic-checklist-v1`

## Scope and prerequisite

Phase 8 converts unresolved records from the exact active Phase 7 assessment run
into source-grounded work. It does not compare raw documents, re-decide
eligibility, provide legal advice, or guarantee eligibility or bid success.
Generation requires the current tender version, active completed Phase 5
extraction, current completed `EARLY` risk run, current human `CONTINUE`, and an
active completed, non-invalidated Phase 7 run whose relational evidence snapshot
still matches those inputs. Older work is never silently selected.

The checklist distinguishes missing documents from missing structured evidence,
document-content examination, evidence verification, expiry, conflict, ambiguous
requirements, human review, tender clarification, profile correction, and
reassessment. Incomplete source coverage produces review work, never a false claim
that a document is missing.

## Source-state mapping and human control

`MISSING` maps conservatively to a typed evidence action based on the requirement
category. `HUMAN_REVIEW_REQUIRED` maps to requirement or applicability review.
`CONFLICT` maps to conflict resolution. `LIKELY_MET` produces work only for an
explicit direct-proof, verification, or document-scope gap. `VERIFIED` and
`NOT_APPLICABLE` produce no normal item. Every item retains Phase 7 assessment,
structured requirement, and validated tender citation links.

Machine proposals—type, title, explanation, priority, rationale, evidence need,
completion criteria, rule, and policy version—are immutable. Human title,
description, priority, assignment, due date, status, block reason, dismissal, and
resolution fields remain separate and append an event to checklist history.

## Taxonomy, limits, and priority

Controlled types are declared in `@tender/domain`; `OTHER` requires an explicit
human explanation. Priority policy `checklist-priority-v1` treats a mandatory
missing, conflicting, or expired input as `BLOCKING`; other mandatory review as
`HIGH`; conditional work as `MEDIUM`; and optional improvement as `LOW`. Priority
means workflow urgency, not predicted rejection or success.

Limits are 2,000 assessments and 2,000 generated items per run, 100 list records
per page, 240 title characters, 2,000 description/explanation characters, 1,000
rationale characters, two bounded queue attempts, worker concurrency two, and a
five-minute SSE connection. Jobs contain opaque identifiers only and generation
does not read binary files.

## Dates and conservative deduplication

Date policy `checklist-dates-v1` permits a cited requirement, clarification,
pre-bid, submission, or evidence-expiry date, or a documented internal buffer.
Official and internal dates are distinct. When no reliable source is available the
date remains unset and the interface says “No reliable due date established.”
Phase 8 sends no email, SMS, push, calendar, or external notification.

Deduplication policy `conservative-checklist-dedup-v1` hashes organisation, tender
version, assessment run, type, canonical category, financial year, manufacturer,
scope, and obligation. Title text is not a key. Different years, manufacturers,
scopes, certificates, authorities, conditions, or materially different dates stay
separate. All equivalent assessment, requirement, and citation links are retained.

## Resolution, invalidation, and untrusted content

`OPEN`, `IN_PROGRESS`, `BLOCKED`, `READY_FOR_REASSESSMENT`, `RESOLVED`,
`DISMISSED`, `SUPERSEDED`, and `INVALIDATED` are controlled states. Blocking and
dismissal require rationale. Upload proves only that a file exists. Resolution
requires linked current Phase 7 assessments to have left unresolved states; workers
cannot resolve, dismiss, verify, or mark a requirement not applicable.

Authoritative tender, extraction, risk, pursuit, assessment, evidence, document,
profile, or policy changes make the current fingerprint stale. A new generation
must reconsider the inputs. Historical runs and human history remain readable;
resolved or dismissed state is never silently copied.

Tender wording, evidence text, filenames, and notes are untrusted data. They cannot
execute tools, fetch URLs, alter permissions, resolve work, reveal another tenant,
or submit a bid. Logs and SSE contain safe IDs, counts, stages, versions, and
timestamps—not tender or company content. Phase 9 RAG, drafting, final readiness,
export, scraping, and submission remain deferred.
