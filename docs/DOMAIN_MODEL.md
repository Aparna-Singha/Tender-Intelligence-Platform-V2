# Domain Model

## Modelling principles

- PostgreSQL holds authoritative domain state.
- Customer-owned entities are scoped to exactly one organisation unless explicitly
  documented as platform-owned.
- Source documents are immutable versions; corrections create new versions and
  preserve provenance.
- AI suggestions never become approved facts or decisions without the required
  validation and human action.
- Important findings are inseparable from their citations.

## Core concepts

| Concept                | Meaning                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| User                   | An authenticated person with a platform identity                   |
| Organisation           | A tenant boundary for people, evidence, tenders, and exports       |
| Membership             | A user's role and status within an organisation                    |
| Company profile        | Versioned structured facts asserted by the organisation            |
| Company document       | A private reusable evidence file and its processing state          |
| Evidence item          | A cited fact extracted from or manually linked to company evidence |
| Tender                 | The organisation's workspace for one procurement opportunity       |
| Tender document        | A versioned tender PDF, annexure, ZIP member, or corrigendum       |
| Source reference       | Official URL and manual provenance metadata                        |
| Requirement            | A structured obligation, criterion, date, or requested submission  |
| Finding                | A cited risk, ambiguity, conflict, or material observation         |
| Eligibility assessment | Requirement-to-evidence evaluation in a controlled state           |
| Checklist item         | Missing document, action, review, or resolution required           |
| Conversation           | Tender-scoped RAG interaction visible to authorized members        |
| Draft                  | A versioned, fact-constrained generated or edited artifact         |
| Review                 | Human disposition of a finding, assessment, or draft version       |
| Readiness audit        | Point-in-time final evaluation, including the second risk analysis |
| Export package         | Immutable manifest of approved review artifacts                    |
| Audit event            | Append-oriented security and business action record                |

## Roles

The product recognizes MSME owner/admin, tender executive, tender consultant,
reviewer/approver, and platform administrator. Roles grant permissions, not ownership
of facts. An individual may hold different roles in different organisations.

Platform administrators are not organisation members by default. Exceptional support
access must be time-bound, justified, approved where required, and audited.

## Tender aggregate

A tender aggregate owns its manually supplied metadata, source references, document
versions, processing status, requirements, findings, assessments, checklist, drafts,
reviews, readiness audits, and exports.

Annexures and corrigenda retain their identity and relationship to the tender.
Corrigenda do not silently overwrite prior requirements. Supersession links record
what changed, the relevant source citations, and unresolved conflicts.

Suggested lifecycle:

`created → uploading → processing → analysis_ready → under_review → readiness_review
→ export_ready → archived`

Failure and hold states must be explicit. Transitions are authorized and audited;
background jobs cannot imply human approval.

## Citations

Every material tender finding and tender-derived answer includes:

- stable document identifier and version;
- human-readable document name;
- one-based page number as presented to the user;
- clause or section label when available;
- exact source span offsets or stable extraction coordinates;
- a bounded excerpt for verification;
- extraction and source version metadata.

If page or clause identity cannot be established, the system marks the result
unsupported or human-review-required rather than fabricating a citation.

## Eligibility assessment states

| State                   | Meaning                                                     | Minimum behavior                             |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `verified`              | Current approved evidence directly supports the requirement | Cite tender requirement and company evidence |
| `likely_met`            | Evidence suggests a match but needs confirmation            | Explain uncertainty and request review       |
| `missing`               | Required support is absent or expired                       | Add or link a checklist item                 |
| `conflict`              | Evidence contradicts the requirement or other evidence      | Block silent resolution and require review   |
| `not_applicable`        | Requirement does not apply, with a recorded rationale       | Require rationale and appropriate approval   |
| `human_review_required` | Ambiguity or stakes prevent a safe automated state          | Route to an authorized reviewer              |

State changes retain actor, timestamp, rationale, input versions, and previous state.
AI may propose a state but cannot finalize `verified`, `not_applicable`, or resolve a
`conflict` without policy-defined human action.

## Risk analysis

Risk is evaluated at two required points:

1. after tender processing and before drafting; and
2. in the final readiness audit before export.

Each risk finding has category, severity, status, rationale, citations, owner,
review state, and source/input versions. The final audit is a new point-in-time
evaluation, not a reused first report.

## Evidence and drafts

Company facts are versioned, attributable, reviewable, and linked to evidence.
Expiration and supersession are explicit. Draft generation may use only tender
sources and approved, in-scope company facts. Unsupported placeholders remain
clearly marked and cannot be exported as approved facts.

## Invariants

- A user cannot access an organisation solely by knowing an identifier.
- A tender document belongs to the same organisation as its tender.
- A citation targets the exact version used during analysis.
- An export cannot be marked ready without a completed final readiness audit.
- Blocking findings and unresolved conflicts require an explicit authorized
  disposition before export.
- Corrigenda added after an audit invalidate affected analysis, approval, and export
  readiness.
- Deleting source evidence invalidates or retains, according to policy, dependent
  outputs without leaving misleading approved claims.

## Progressive onboarding and company profile

Onboarding is an eight-step, resumable workflow scoped to a user and organisation.
Company profile values are organisation-owned and stored as individually typed
records rather than one response document. Each important value records its source,
verification state, optional future evidence-document reference, update time, and
updating user. Annual turnover and document readiness use dedicated structured
tables.

Profile verification states are `SELF_DECLARED`, `DOCUMENT_VERIFIED`, `EXPIRED`,
`CONFLICTING`, and `HUMAN_REVIEW_REQUIRED`. Phase 2 creates only self-declared
values because document upload and verification are not implemented.

Reseller, service-provider, and consultant business models add conditional
completeness requirements. Completion percentage is guidance, not an eligibility
or tender-match decision.

## Reusable company document vault

A `Document` is an organisation-owned logical record with category, owner, expiry,
verification, retention, deletion, and processing state. A `DocumentVersion` is
immutable binary metadata: original filename, declared and detected type, byte
count, SHA-256, opaque object keys, uploader, and version number. Corrections create
versions rather than overwriting evidence.

Only `READY` documents with an approved current version may receive a signed
download. All earlier, quarantined, rejected, failed, and expired states deny
download. Access attempts and lifecycle changes are append-oriented audit data.
Deletion is requested first; the worker respects retention before removing all
object versions and marking the record deleted.

## Manual tender ingestion

`TenderWorkspace` is the organisation-private container for a `Tender`. A tender
has a current immutable `TenderVersion`; source changes and corrigenda create new
versions rather than overwriting history. `TenderDocument` records typed
attachments and opaque private-object references. `TenderSource` preserves
adapter, provenance, official URL, and external identifiers. `TenderCorrigendum`
links affected and resulting versions. `ProcessingJob` is the authoritative,
idempotency-keyed asynchronous lifecycle record.

Curated fixtures always carry “Demonstration tender — not live procurement
information.” Phase 4 ends at `SOURCE_READY`; no state implies successful parsing,
eligibility, analysis, or bid readiness.

## Tender extraction

Phase 5 adds `ExtractionRun`, `ExtractionRunDocument`, `ExtractedUnit`,
`ExtractedBlock`, `ExtractedTable`, `ExtractedTableCell`, `ClassifiedSection`,
`ExtractedTenderField`, `StructuredRequirement`, `ExtractionCitation`,
`ExtractionIssue`, and `ExtractionReview`. Runs move through `QUEUED`, `PARSING`,
`STRUCTURING`, and `COMPLETE`, or terminal `FAILED`, `CANCELLED`, and `INVALIDATED`
states. Results are immutable. Review records preserve corrections separately, and
the active completed run is only a pointer on a tender version.

## Early tender-risk analysis

`RiskAnalysisRun` targets one tender version and active extraction.
`RiskFinding` separates category, severity, confidence, materiality, lifecycle, and
review state. `RiskFindingCitation` reuses exact extraction citations.
`RiskFindingReview` preserves human disposition history. `EarlyPursuitDecision`
records human-only CONTINUE/HOLD/STOP choices and supersession. No record is an
eligibility assessment or legal conclusion.

## Controlled company-evidence assessment

Phase 7 represents company evidence through `CompanyEvidenceFact`, immutable
`CompanyEvidenceFactVersion`, human-captured `CompanyEvidenceCitation`, relational
`EligibilityInputSnapshot` children, historical `EligibilityAssessmentRun`,
requirement-level `EligibilityAssessment`, evidence links, and append-only reviews.
The original machine proposal is never overwritten by a human final state.

## Missing evidence and action checklist

`ChecklistGenerationRun` targets the exact active Phase 7 run and evidence snapshot.
`ChecklistItem` preserves immutable proposed fields separately from human title,
description, priority, assignment, due date, and status. Relational links retain all
source assessments, structured requirements, and tender/company citations.
`ChecklistItemHistory` appends every human transition.

Items move through `OPEN`, `IN_PROGRESS`, `BLOCKED`,
`READY_FOR_REASSESSMENT`, `RESOLVED`, `DISMISSED`, `SUPERSEDED`, and
`INVALIDATED`. Upload alone cannot resolve an item. Resolution normally requires a
fresh or reviewed Phase 7 result showing the underlying gap is no longer unresolved.
Checklist workflow progress is not eligibility, bid readiness, or success
probability.

## Tender-scoped RAG conversation

`RagIndexRun` is immutable and tied to one organisation, tender version,
extraction, source mode, policy set, and embedding configuration. `RagChunk`
retains source class, document, page, clause, extraction coordinates, version, and
checksum.

`RagConversation` fixes its tenant, tender, mode, and index. Every user
`RagMessage` creates a fresh `RagAnswerRun`, `RagRetrievalRun`, and ranked
`RagRetrievalHit` set. `RagAnswerCitation` may reference only a handle from that
retrieval. History is not evidence. Answers may be insufficient, require review,
fail, or become invalid; they cannot decide eligibility, draft, approve, export,
or submit.

## Fact-constrained draft

`DraftGenerationRun` and `DraftInputSnapshot` bind generation to exact current
Phase 5–9 records and versioned policies. `DraftTemplateVersion` controls section
shape. `Draft` points to an immutable `DraftVersion`; sections contain classified
claims, exact citations, and visible placeholders. `DraftHumanInput` separates
writing preferences from reviewed commitments. `DraftReview` and
`DraftReviewEvent` preserve human-only review history.

Generated content is never authoritative merely because a model produced it.
Company assertions reference the accepted evidence-fact version; material tender
statements require exact source citations. Edits create child versions and never
inherit approval. Invalidated versions remain historical and cannot be approved.
See [Draft Policy](DRAFT_POLICY.md).

## Final readiness and second risk analysis

Phase 11 is designed but not yet implemented. A proposed `FinalReadinessRun` owns an
immutable relational snapshot of exact current Phase 5–10 authority, readiness
findings, reviews, and an append-oriented human `FinalReadinessDisposition`. A
separate linked `RiskAnalysisRun` with `gateType = FINAL_READINESS` owns the second
deterministic machine risk analysis and never creates an `EarlyPursuitDecision`.

The hard gate requires the authoritative records needed to take the snapshot;
unresolved ambiguity, risk, evidence, checklist, and limitation states become cited
audit findings. Readiness treatment is `BLOCKER`, `HUMAN_DISPOSITION_REQUIRED`,
`WARNING`, or `INFORMATIONAL` and remains distinct from risk severity. V1 requires
one compliant approved `CONSOLIDATED_FIRST_DRAFT`, no RAG index, and no provider.

Only an eligible independent human may record proceed to controlled export review,
hold for remediation, or stop pursuit. Proceed authorises neither export nor
submission. Stale inputs fail closed while historical snapshots, findings, reviews,
and decisions remain attributable. See
[Final Readiness Policy](FINAL_READINESS_POLICY.md).
