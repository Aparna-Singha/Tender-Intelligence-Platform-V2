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
