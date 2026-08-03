# Early Tender-Risk Policy

Phase 6 implements only the `EARLY` gate over the active completed extraction.
`FINAL_READINESS` is a distinct future evaluation and is not implemented.

Policy `early-deterministic-v1` detects explicit extraction uncertainty, EMD,
performance security, penalties, OEM/manufacturer and reseller restrictions,
MSME/Startup relaxation wording, payment/retention, warranty/maintenance, delivery
timelines, and complex submission instructions. Severity is review priority, not
legal truth. Confidence describes source certainty separately from importance.
Materiality is `NON_MATERIAL`, `MATERIAL`, `POTENTIALLY_BLOCKING`, or
`BLOCKING_REQUIRES_HUMAN_DISPOSITION`. No opaque score is produced.

Every finding reuses validated Phase 5 citations. Unsupported candidates are
discarded. Tender text is untrusted data and cannot invoke tools, fetch URLs, change
permissions, accept risk, or select a pursuit decision.

Machine findings start unreviewed. Authorised humans append reviews without changing
the immutable machine rationale or citations. Only a human can record `CONTINUE`,
`HOLD`, or `STOP`, with rationale and acknowledged limitations. No option is
preselected or recommended.

A new active extraction invalidates the current early report and supersedes its
decision; history remains auditable. This analysis is not legal advice, does not
determine eligibility, and cannot guarantee complete risk detection. Evidence
comparison is deferred to Phase 7, missing-document checks to Phase 8, and final
readiness risk analysis to a later phase.

The accepted design for the separate deterministic `FINAL_READINESS` gate is in the
[Final Readiness Policy](FINAL_READINESS_POLICY.md). This document remains the
EARLY-only Phase 6 policy.
