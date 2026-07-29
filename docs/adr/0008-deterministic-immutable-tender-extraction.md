# ADR 0008: Deterministic, immutable tender extraction

- Status: Accepted
- Date: 2026-07-29

## Context

Tender files are untrusted evidence. Extracted requirements must be auditable,
reproducible, tenant-isolated, and distinct from eligibility or risk decisions.

## Decision

Use bounded, format-specific deterministic parsers for PDF, DOCX, XLSX, CSV, and
approved ZIP members. Persist every attempt as an immutable extraction run tied to
an exact source fingerprint and parser/structuring policy versions. A completed run
is activated atomically for its tender version; retries create new runs. Reviews
and corrections are append-only and never overwrite machine output.

Every important field and requirement must have a validated citation to an approved
source document, unit, offsets, checksum, and bounded excerpt. Unsupported or
uncertain content requires human review. No LLM is used in this phase. Scanned
pages report `OCR_UNAVAILABLE` until a real OCR adapter is configured.

## Consequences

- Results are reproducible and historical runs remain inspectable.
- Parser upgrades require a policy-version change and regression evaluation.
- Complex layouts and scanned files have explicit, visible quality limitations.
- Extraction cannot express company eligibility, risk, matching, RAG, or drafting.

## Alternatives considered

- Mutable latest-result rows were rejected because they destroy audit history.
- LLM-only extraction was rejected because deterministic citation validation and
  reproducibility are required.
- Pretend OCR and silent best-effort parsing were rejected because they
  misrepresent extraction coverage.

## Follow-up constraints

Run parsers only in bounded workers, keep binaries in private object storage, never
execute spreadsheet formulas or active document content, and fail closed before
completion if citation validation fails.
