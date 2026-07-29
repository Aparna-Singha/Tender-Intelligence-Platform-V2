# Company Evidence Policy

## Scope

Phase 7 compares cited tender requirements with an immutable, tenant-scoped
snapshot of structured company information. It does not decide that an
organisation is globally eligible, provide legal advice, or guarantee bid success.

Authoritative company inputs are typed `CompanyProfileValue` and
`CompanyTurnover` records, document-readiness records, current private company
documents in `READY` approved storage, and reviewed versions of manually captured
company evidence facts. A document category, filename, or mere existence never
proves its detailed contents.

## Manually captured evidence

Company-document extraction does not currently provide reliable page-level facts.
Authorised users may therefore capture one bounded typed assertion from an exact
approved `DocumentVersion`. Each fact is immutable and versioned. Its citation
records the source checksum, document name and category, a bounded excerpt, and
only those page, section, sheet, or cell coordinates supplied by the user.
Coordinates are never invented. OCR is unavailable; scanned sources require
manual capture and reviewer confirmation.

An accepted fact must have a citation to the same current document version.
Corrections create a new version; historical snapshots keep the old version.
Private object keys and document contents are excluded from logs, queues, list
responses, SSE events, and traces.

## Human control

Machine comparison may propose `likely_met`, `missing`, `conflict`, or
`human_review_required`. Only an authorised reviewer can finalise `verified` or
`not_applicable`, and only a reviewer can resolve a conflict. Verification requires
valid tender and company citations, direct support, a current approved source, no
unresolved contradiction, and an explicit rationale.

Phase 8 will turn controlled missing assessments into checklist actions. Phase 9
will add tenant-isolated RAG. Neither is implemented here.
