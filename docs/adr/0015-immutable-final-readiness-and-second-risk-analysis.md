# ADR 0015: Immutable Final Readiness and Second Risk Analysis

- Status: Accepted for Phase 11 design; implementation pending
- Date: 2026-08-03

## Context

Phase 11 must evaluate unresolved Phase 5–10 state rather than preventing the audit
from running. It must also preserve the distinction between a machine second risk
analysis and an authorised human final-readiness disposition. Treating all findings
as start failures, placing a future risk run inside its own input snapshot, or
reusing `EarlyPursuitDecision` would create incomplete audits, circular authority,
or incorrect semantics.

## Decision

Adopt policy `final-readiness-deterministic-v1` and implement two linked but separate
records:

- a `FinalReadinessRun` owns the immutable Phase 5–10 snapshot, readiness findings,
  reviews, and final human disposition;
- an existing `RiskAnalysisRun` with `gateType = FINAL_READINESS` owns the
  deterministic second machine risk analysis.

The readiness input snapshot excludes the linked final-risk run. One serializable
start transaction validates hard prerequisites; creates the readiness run, relational
snapshot, and already-linked final-risk run; stores the complete fingerprint; and
commits before an opaque-ID job is enqueued. Uniqueness constraints and bounded
serialization retry prevent duplicate authority.

Hard prerequisites require current same-tenant records through Phase 8 and exactly
one compliant current approved `CONSOLIDATED_FIRST_DRAFT`. Phase 9 RAG is not
required. Unresolved extraction, risk, eligibility, evidence, checklist, warning,
and limitation states become cited audit findings rather than start failures.

Phase 11 v1 is fully deterministic. It adds no provider, model, prompt, or RAG
dependency. Readiness treatment is separately classified as `BLOCKER`,
`HUMAN_DISPOSITION_REQUIRED`, `WARNING`, or `INFORMATIONAL`; it does not overload
risk severity. Evidence uses a versioned 30-day expiry-warning horizon.

Use a separate `FinalReadinessDisposition` with
`PROCEED_TO_CONTROLLED_EXPORT_REVIEW`, `HOLD_FOR_REMEDIATION`, and `STOP_PURSUIT`.
Proceed authorises only the beginning of the future Phase 12 controlled export
review. It never authorises or automates submission.

An `OWNER`, `ADMIN`, or `REVIEWER` with an explicit decision permission may decide
only when different from the readiness requester and consolidated-draft creator.
There is no single-user bypass and no implicit `PLATFORM_ADMIN` tenant access.

Before Phase 11 accepts a draft approval, production implementation must enforce
`DraftTemplateVersion.requiredReviewRole` and capture the approver's organisation
role at approval time. Historical approvals without verifiable role evidence require
fresh compliant approval.

Read-time fingerprint validation is mandatory. Eager invalidation supplements but
never replaces it. The final-decision transaction rechecks current pointers, both
run statuses, fingerprint, permissions, separation of duties, findings,
acknowledgements, and provenance. Historical records remain attributable and
readable.

## Consequences

- Audits can expose unresolved blockers instead of failing before evaluation.
- Machine risk and human readiness authority remain distinct and auditable.
- Relational snapshots and source links add rows and validation queries but prevent
  forged, stale, or cross-tenant provenance.
- Phase 11 requires a migration, new domain/contracts/API/worker/web behavior, and
  comprehensive security tests in later implementation tasks.
- Single-user organisations must add an eligible independent reviewer.
- Existing unverifiable draft approvals cannot be grandfathered into Phase 11.
- Phase 12 export remains separately authorised and unimplemented.

## Alternatives rejected

- Blocking audit start on unresolved findings was rejected because those findings
  are the audit's inputs.
- Including the final-risk run in its own readiness input snapshot was rejected as
  circular.
- Combining final risk and readiness was rejected because machine analysis is not a
  human decision.
- Reusing `EarlyPursuitDecision` was rejected because pursuit and controlled-export
  review have different semantics.
- Requiring Phase 9 RAG or provider analysis was rejected because v1 can evaluate
  authoritative relational state deterministically.
- A generic JSON readiness report was rejected because it weakens provenance,
  authorization, invalidation, and queryability.
- A single-user decision bypass was rejected because it defeats separation of
  duties.

## Implementation status

This ADR locks Phase 11 architecture and policy only. No Phase 11 schema, migration,
API, worker, web, contract, or domain implementation exists yet.
