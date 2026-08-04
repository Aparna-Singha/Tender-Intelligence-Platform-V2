# ADR 0016: Immutable Controlled Review-Package Export

- Status: Proposed
- Date: 2026-08-04

## Context

Phase 11 permits a future controlled export review only after a current,
independently authorised human disposition. Phase 12 must turn that authority into
reviewable private bytes without treating generation as approval, silently exporting
newer mutable state, creating new claims, or providing submission capability.

The repository already uses PostgreSQL authority, immutable run snapshots, BullMQ
opaque jobs, private S3-compatible storage, short-lived signed URLs, SHA-256,
content sniffing and ClamAV. It has ZIP primitives and PDF parsing, but no PDF or
DOCX generator.

## Decision

Adopt policy `controlled-review-package-deterministic-v1` and a new
`ControlledReviewPackageRun` aggregate. A serializable start transaction validates
the current Phase 11 Proceed decision and exact upstream authority, creates a
separate immutable package-input snapshot, and commits before enqueueing an opaque
job. The snapshot references the Phase 11 snapshot and relationally pins the exact
decision, approved draft, approval evidence, sources, hashes, template and policies.

Separate machine generation status, human review status and calculated freshness.
Retries and regeneration create new immutable runs and object prefixes. A current
pointer changes only when an independently reviewed package is approved. Historical
runs, reviews, approvals, grants and checksums remain attributable.

V1 generates one bounded ZIP containing a deterministic review PDF, manifest JSON,
provenance-index JSON and checksum file. It excludes raw supporting binaries, DOCX,
macros, signatures, external delivery and public links. A separate versioned export
template controls declarative rendering; draft templates are not reused.

Approve-for-download is human-only. The approver is an Owner, Admin or Reviewer with
explicit permission and differs from the package requester and approved-draft
creator. No countersign or single-user bypass exists. Download requires a fresh,
generated, current, approved and non-revoked package. V1 uses the existing
purpose-bound one-minute presigned URL and accurately describes it as reusable until
expiry.

The worker deterministically copies authoritative approved content and creates only
structural material. It uses no LLM, RAG or provider. Final bytes are type-checked,
checksum-verified and ClamAV-scanned before atomic private promotion. Object keys,
signed URLs and content remain out of public metadata, queues and logs.

## Consequences

- Phase 11 authority remains unchanged and is never reinterpreted as submission
  approval.
- Separate snapshots prevent exporting newer data than the human decision covered.
- A ZIP plus PDF provides one review unit while avoiding editable DOCX and broad raw
  attachment exposure.
- Relational provenance, immutable artifacts and append-only review add storage and
  schema complexity but enable audit and fail-closed freshness.
- PDF generation requires a separately reviewed dependency or minimal native
  implementation before worker delivery.
- Already downloaded bytes cannot be recalled; revocation blocks future grants and
  preserves the historical download record.

## Alternatives rejected

- Reusing the Phase 11 snapshot without a package snapshot was rejected because
  content selection, template and artifact policy also require immutable authority.
- Exporting the current live tender state was rejected as a stale-authority bypass.
- Storing the package in PostgreSQL was rejected because private object storage is
  the accepted binary boundary.
- Generating DOCX in v1 was rejected because editable content and OOXML active
  relationships expand risk without an existing generator.
- Bundling every source file was rejected due to privacy, malware and package-size
  exposure.
- Digital signing was rejected because no key-management/signing requirement or
  infrastructure exists; checksums must not be mislabeled as signatures.
- Combining generation and human approval was rejected because machine output cannot
  authorise controlled download.
- Public or long-lived links were rejected by the private-storage boundary.

## Follow-up constraints

- Resolve the PDF renderer and PDF/A target through dependency, licence and security
  review before worker implementation.
- Resolve production retention and whether single-use streamed downloads are legally
  or operationally required before enabling production downloads.
- Keep this ADR Proposed until the architecture is reviewed; implementation must not
  be described as present before tests and migration are complete.
