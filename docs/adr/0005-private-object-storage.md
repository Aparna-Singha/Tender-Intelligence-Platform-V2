# ADR 0005: Use Private S3-Compatible Object Storage

- Status: Accepted
- Date: 2026-07-29

## Context

Company evidence, tender documents, extracted artifacts, drafts, and exports may
contain confidential, personal, or commercially sensitive information. Binary
objects can be large and require lifecycle controls that differ from relational
metadata.

## Decision

Store binary files in private S3-compatible object storage with public access
blocked. PostgreSQL stores authoritative ownership, organisation scope, object key,
version, classification, integrity metadata, processing state, and lifecycle state.

Use opaque server-generated object keys and least-privilege service identities.
Authorize every upload and download through the application. Where direct transfer
is needed, issue short-lived, purpose-bound signed URLs. Quarantine new uploads until
type, size, archive, and malware controls pass.

Encryption at rest, TLS in transit, access logging, versioning or recovery controls,
retention, deletion of derived artifacts, and backup behavior must be configured and
tested before production.

## Consequences

- Binary storage scales independently while business ownership remains transactional
  in PostgreSQL.
- Application and lifecycle logic must prevent orphaned database records or objects.
- Local and CI environments need a compatible, non-production storage strategy
  without weakening production privacy.
- Signed URLs and caches must have bounded lifetimes and must not appear in logs.

## Alternatives considered

- **Public object URLs:** rejected because documents are private by default.
- **Database binary columns for all files:** rejected due to backup, transfer, and
  lifecycle costs.
- **Local application filesystem:** rejected because it is unsuitable for durable,
  horizontally scaled production workloads.
