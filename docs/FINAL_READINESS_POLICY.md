# Final Readiness and Second Risk Analysis Policy

Policy version: `final-readiness-deterministic-v1`

Status: implemented and merged through PR #12.

## Scope and boundary

Phase 11 creates an immutable, tenant-scoped final-readiness audit and a linked
second risk analysis immediately before the future controlled export workflow. It
does not export a file, approve submission, provide legal advice, guarantee
eligibility or completeness, discover every risk, scrape a portal, price a bid, or
submit one. Phase 12 remains a separate controlled export workflow.

The two Phase 11 records have different authority:

- `RiskAnalysisRun` with `gateType = FINAL_READINESS` owns the deterministic second
  machine risk analysis. It reuses risk severity, confidence, materiality, status,
  review, and cited-provenance concepts where valid. It does not update
  `activeEarlyRiskRunId`, create an `EarlyPursuitDecision`, or execute EARLY-specific
  invalidation.
- `FinalReadinessRun` owns prerequisite snapshotting, readiness
  findings and provenance, readiness reviews, and the final human disposition.

Machine risk findings and final human readiness decisions remain separate,
immutable, attributable concepts.

## Hard start prerequisites

The API may start a Phase 11 v1 run only when all of these authoritative records
exist, are current, are non-invalidated, and have exact organisation, tender, and
tender-version scope consistency:

- the current tender and `TenderVersion`;
- a current source set that can be snapshotted with exact document identifiers,
  roles, and checksums;
- the active completed Phase 5 `ExtractionRun`;
- the current completed Phase 6 `RiskAnalysisRun` with `gateType = EARLY`;
- the current unsuperseded human `CONTINUE` decision for that EARLY run;
- the current completed Phase 7 `EligibilityAssessmentRun` and its exact relational
  `EligibilityInputSnapshot`;
- the current completed Phase 8 `ChecklistGenerationRun` tied to that assessment
  and evidence snapshot;
- exactly one qualifying current approved `CONSOLIDATED_FIRST_DRAFT` version.

Phase 11 v1 does not require a Phase 9 RAG index. It is fully deterministic and
does not call Gemini or another model, perform provider-assisted risk detection, or
snapshot model or prompt configuration.

The consolidated draft must be the current `DraftVersion`, approved through the
Phase 10 model by an actor other than its creator, non-invalidated,
non-superseded, and based on current source fingerprints. It must contain no:

- unresolved approval-blocking placeholder;
- unsupported, conflicting, expired, or `HUMAN_REVIEW_REQUIRED` material claim;
- unvalidated human-edited section; or
- unreviewed material human commitment.

Phase 11 v1 has no organisation-configurable required draft set. A later policy
version may add tender-specific or configurable required draft types.

## Starting an audit is not a readiness conclusion

The audit must be able to examine unresolved conditions. The following do not
prevent start when their authoritative upstream records satisfy the hard gate:

- extraction ambiguity or conflict;
- unresolved or accepted EARLY risk;
- `MISSING`, `CONFLICT`, `LIKELY_MET`, or `HUMAN_REVIEW_REQUIRED` eligibility;
- expired or expiring evidence;
- unresolved checklist work or work ready for reassessment; and
- unresolved warnings or limitations.

These become cited Phase 11 findings. They may prevent
`PROCEED_TO_CONTROLLED_EXPORT_REVIEW`, but they must not make the audit impossible
to run.

## Read-only preflight

Phase 11 should expose a read-only preflight operation following existing
organisation-and-tender controller conventions. It reports:

- whether every hard prerequisite exists;
- bounded missing and stale prerequisite codes;
- current source and version identifiers safe for the authorised client;
- the qualifying consolidated draft version; and
- whether an eligible independent final-decision actor exists.

Preflight is informational, race-prone, and never an authoritative readiness
conclusion. A successful preflight cannot bypass start validation. The start
transaction repeats every check against locked or transactionally consistent
authority.

## Immutable ownership and snapshot

The ownership direction is:

```text
FinalReadinessRun
├── FinalReadinessInputSnapshot
└── linked RiskAnalysisRun (gateType = FINAL_READINESS)
```

The input snapshot does not contain the linked FINAL_READINESS risk run as an
input. It relationally records the exact organisation, tender, tender version,
source documents and checksums, extraction run and fingerprint, EARLY risk run,
pursuit decision, eligibility run and evidence snapshot, checklist generation run,
qualifying consolidated draft and exact approved version, draft input snapshot and
template version, policy versions, requester, capture time, idempotency key, and
complete input fingerprint.

Bounded JSON may store non-authoritative display counts only. Authoritative IDs,
versions, checksums, fingerprints, and provenance require relational records.

The start operation uses a serializable transaction, or the safest equivalent
supported by the repository, plus uniqueness constraints and bounded retry for
serialization conflicts. It validates the hard gate; creates the readiness run,
snapshot and relational children; creates the linked FINAL_READINESS risk run;
connects both runs; persists the fingerprint; and commits. Only after commit may it
enqueue opaque identifiers. The worker processes those already-created records and
must not create a new authoritative risk run.

## Deterministic second-risk policy

The linked FINAL_READINESS analysis evaluates current relational Phase 5–10 state,
including extraction uncertainty, EARLY findings and reviews, evidence state and
expiry, checklist work, approved draft claims and citations, human commitments,
placeholders, current corrigenda, deadlines, and stale derived records.

Every material risk finding requires validated relational provenance. Unsupported
candidates are not presented as established facts. Risk severity remains the
importance of a risk; it is not readiness treatment or legal certainty.

Provider-assisted analysis is deferred. Introducing it requires a new policy
version, revised acceptance criteria, explicit provider privacy approval, and
provider-backed evaluation.

## Readiness finding treatment

Readiness treatment is separate from `RiskSeverity`:

- `BLOCKER` prevents the proceed disposition until a fresh current run shows the
  condition resolved.
- `HUMAN_DISPOSITION_REQUIRED` requires an authorised, current, attributable human
  disposition.
- `WARNING` remains visible and requires acknowledgement where policy specifies.
- `INFORMATIONAL` communicates context and limitations without implying approval.

Examples of blockers include stale prerequisites after start, invalid material
citations, unresolved mandatory `MISSING` or `CONFLICT`, expired mandatory evidence,
unresolved `BLOCKING` checklist work, unsupported or conflicting material draft
claims, unresolved material placeholders, stale draft snapshots, and missing
independent approval.

Examples requiring human disposition include mandatory `LIKELY_MET`, material
extraction ambiguity, accepted risk requiring acknowledgement, policy-disposable
open material risk, and material limitations that cannot be resolved
deterministically.

Warnings include evidence expiring within 30 days, non-blocking checklist work,
authoritatively supported approaching deadlines, and non-material accepted risks.
Informational findings include non-affiliation, product limitations, lack of a
complete-risk guarantee, and useful resolved or historical context.

Every material readiness finding references exact relational provenance such as an
extraction citation, risk finding and review, eligibility assessment, evidence fact
version and citation, checklist item, draft version, draft claim and citation,
placeholder, or human review. Source bodies are not copied into queue payloads,
logs, audit metadata, or generic snapshot JSON.

## Evidence expiry

The versioned v1 expiry policy uses a 30-day warning horizon:

- already expired authoritative evidence is a blocker when material;
- evidence expiring within 30 days is a warning;
- evidence expiring later is informational only when relevant; and
- absence of an expiry date never permits an invented expiry.

## Human final disposition

Phase 11 introduces a separate `FinalReadinessDisposition` concept with:

- `PROCEED_TO_CONTROLLED_EXPORT_REVIEW` — “Proceed to controlled export review”;
- `HOLD_FOR_REMEDIATION` — “Hold for remediation”;
- `STOP_PURSUIT` — “Stop pursuit”.

No option is preselected. Proceed means only that Phase 12 may begin its own
controlled export workflow. It does not mean approved to submit, legally compliant,
guaranteed eligible, guaranteed complete, or ready for automatic submission.

Proceed is permitted only when the readiness run and linked FINAL_READINESS risk
run are current and complete, no blockers remain, every required human disposition
is valid and current, every material finding has valid provenance, required
acknowledgements are recorded, and the complete fingerprint still matches
authoritative state. Hold and stop may be recorded on a current completed run while
blockers exist, with mandatory rationale.

The decision is append-oriented and records actor, organisation, run and exact
fingerprint, disposition, rationale, acknowledgements, timestamp, request/correlation
ID, and any superseded decision.

## Permissions and separation of duties

Only `OWNER`, `ADMIN`, or `REVIEWER` actors with a new explicit final-readiness
decision permission may record the disposition. The actor must differ from both the
`FinalReadinessRun` requester and the creator of the required approved consolidated
draft. The actor may be the existing independent draft approver. No additional
Owner/Admin countersign is required in v1.

If no eligible second actor exists, the system fails closed and instructs the
organisation to invite or assign an eligible reviewer. There is no single-user
bypass. `PLATFORM_ADMIN` has no implicit tenant authority.

## Required-review-role hardening

`DraftTemplateVersion.requiredReviewRole` is enforced by the draft-approval path,
which records authenticated membership role evidence before Phase 11 treats an
approval as an authoritative prerequisite:

- approval must enforce `requiredReviewRole`;
- approval history must capture the actor's organisation role at approval time;
- later membership changes must not rewrite history;
- existing approvals without verifiable role-at-approval evidence are ineligible;
- an affected version requires a fresh compliant approval; and
- role changes, cross-tenant attempts, and historical approvals require tests.

Historical approvals remain unchanged; no role is inferred or backfilled.

## Invalidation, concurrency, and idempotency

Any authoritative snapshot input change after start makes the run stale or
invalidated. This includes source, version, extraction, citation, EARLY risk or
decision, eligibility or evidence, checklist, draft, approval, template, or policy
changes.

Read-time freshness checking is mandatory. Existing write paths should eagerly
invalidate affected runs where safe, but eager invalidation is never the only
control. Historical runs, findings, reviews, and decisions remain readable.

The final-disposition transaction safely locks or rechecks the active readiness
pointer, run and linked-risk statuses, invalidation state, complete fingerprint,
permission, separation of duties, blockers, required dispositions, provenance, and
acknowledgements. A stale or invalid run cannot receive a new decision.

Idempotency keys, database uniqueness, bounded transaction retry, cancellation,
duplicate-delivery handling, and fingerprint checks before work and before atomic
activation prevent duplicate or stale authority.

## API, worker, and interface direction

The planned organisation-and-tender-scoped API covers preflight, start, current and
historical runs, one run, progress, filtered findings, source access, finding review,
decision and decision history, cancellation, retry, and stale state. It uses the
standard response envelope, safe stable errors, request IDs, server-derived actor
identity, server-derived membership, repeated tenant predicates, bounded pagination,
and append-oriented audit events.

One planned opaque-ID worker job orchestrates snapshot verification, deterministic
FINAL_READINESS risk processing, readiness aggregation, second fingerprint
verification, and atomic activation. It uses bounded time, concurrency, retry, and
cancellation. It never records a human decision, exports, submits, or logs sensitive
content.

The planned URL-addressable `readiness` tender stage appears after Draft and mounts
only while active. It distinguishes deterministic policy results, machine risk
findings, human reviews, and final human decisions; exposes exact provenance and
history; supports safe loading, empty, failed, stale, invalid, and cancelled states;
and remains keyboard and screen-reader accessible at 1440, 1024, 768, and 390 pixels
without document-level horizontal overflow. It provides no export button or green
“ready to submit” claim.

## Security and measurable acceptance

Implementation is accepted only when tests demonstrate tenant and tender isolation,
CSRF enforcement, server-derived authority, forged-ID and citation rejection,
decision replay prevention, separation of duties, duplicate-start idempotency,
serialization-race handling, stale-worker activation prevention, cancellation,
bounded failure, safe telemetry, provenance for every material finding, and
fail-closed invalidation.

Domain, contract, migration, API, worker, security, and responsive UI tests must
cover the full policy. The local stack must complete the supported Phase 5–11 flow
through an authorised human disposition without export. Formatting, linting, strict
type checking, all tests, production build, Docker health, API readiness, worker
health, Ubuntu and Windows CI, dependency review, and secret scanning remain release
gates.
