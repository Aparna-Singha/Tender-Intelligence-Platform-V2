# ADR 0003: Begin with Manual Tender Ingestion

- Status: Accepted
- Date: 2026-07-29

## Context

Users need reliable analysis of tender documents and corrigenda. Automatic portal
collection introduces changing interfaces, terms-of-use, provenance, coverage,
anti-automation, freshness, and legal risks. Claiming comprehensive live coverage
would be misleading without verified integrations and operations.

## Decision

The first product accepts:

- manual PDF upload;
- ZIP and annexure upload;
- corrigendum upload;
- official source URL with manually entered metadata;
- curated demonstration fixtures;
- administrator import.

For GeM manual ingestion, the user creates a tender workspace using the **Bid
No.** (`GEM/YYYY/B/...`), not the related reverse-auction (RA) number, then
uploads the official bid document PDF and any published ATC, specification,
BOQ, or other supporting files. The Tender Files interface asks users to
confirm a role for each file; filename-based suggestions are not authoritative.
Corrections use the separate corrigendum workflow so source-version history is
preserved. A source URL is provenance only and never triggers a portal fetch.

The browser normalizes allowlisted file extensions to canonical upload MIME
types (including CSV files with inconsistent OS-reported types) and preflights
the existing 25 MB per-file limit. API checks, private object storage, signed
uploads, checksum verification, antivirus scanning, and worker processing remain
authoritative. A successful upload is **not** evidence that extraction, review,
eligibility, or bid submission succeeded. Company evidence uploads remain in the
separate company-document vault.

Source type and provenance are visible. A recorded URL is not represented as a
platform-verified fetch or live monitor. Curated fixtures are labelled and isolated
from customer content. Administrator imports follow the same validation,
authorization, provenance, and audit requirements as user uploads.

Automatic GeM scraping and nationwide live-tender claims are excluded.

## Consequences

- The team can validate analysis and bid-readiness value before building broad
  acquisition infrastructure.
- Users are responsible for supplying complete, current source material; the product
  must make that limitation visible.
- Corrigenda are first-class versioned inputs and can invalidate downstream work.
- Future official integrations or automated acquisition require legal, security,
  reliability, and product review plus a superseding or additional ADR.

## Alternatives considered

- **Automatic GeM scraping:** rejected for the initial scope due to authorization,
  reliability, provenance, and maintenance concerns.
- **Aggregator-first ingestion:** deferred because source quality and commercial
  dependency need validation.
- **Demonstrations only:** rejected as insufficient to validate secure customer
  workflows.
