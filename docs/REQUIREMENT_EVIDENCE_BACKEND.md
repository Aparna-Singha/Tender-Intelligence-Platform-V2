# Requirement-level evidence backend

This branch proposes the additive `20261106000100_requirement_evidence_attachments`
migration. It has **not** been applied by this work. The six requirement-scoped
routes remain unavailable against a database until the migration is reviewed and
deployed in migration order. Do not use `db push` or rewrite migration history.

The migration adds `documents.tender_scope_id` and a persistent attachment table.
Composite foreign keys bind organisation, tender, tender version, extraction run,
requirement, document, and exact document version. A partial unique index permits
one active link for a requirement and document version. Detached links and their
source versions remain for audit. The document-scope triggers prevent a tender
document from being linked to another tender. The migration contains no data
updates or drops. Before approval, back up the target database, verify its
pending migration list and existing data against these constraints, and rehearse
the SQL on a restored disposable database. Rollback of a live deployment needs a
backup restore or a separately reviewed compensating migration, since dropping
the new table would destroy attachment history.

Under `/organisations/:organisationId/tenders/:tenderId/versions/:versionId/requirements/:requirementId`, the API provides:

| Method   | Suffix                                       | Result                                                        |
| -------- | -------------------------------------------- | ------------------------------------------------------------- |
| `GET`    | `/attachments`                               | Current and historical attachment status, without object URLs |
| `GET`    | `/evidence-candidates`                       | Searchable organisation documents with exact current versions |
| `POST`   | `/upload-sessions`                           | Private upload URL and persisted pending attachment           |
| `POST`   | `/upload-sessions/:uploadSessionId/complete` | Existing object verification and security-processing queue    |
| `POST`   | `/attachments`                               | Link an existing exact document version as context            |
| `DELETE` | `/attachments/:attachmentId`                 | Detach without deleting the document or version               |

The implementation also permits reading one attachment and abandoning a pending
upload. Existing cookie authentication, CSRF handling, organisation permissions,
document lifecycle, private object storage, and malware scanning remain in use.
Attachment does not approve a fact or an eligibility decision. Current-evidence
verdicts are additive to historical assessment state.

The frontend in PR #43 expects the six listed route shapes. Its upload form sends
the checksum, MIME type, size, and idempotency key; the backend retains the
existing upload validation. Browser-to-storage CORS must allow the signed
`x-amz-meta-sha256` header for actual uploads, as required by the existing
direct-upload flow.

Database-backed and authenticated browser verification require a separately
approved isolated database migration and test environment. Unit and mocked
tests alone cannot establish end-to-end readiness.
