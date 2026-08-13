# Phase 17 Security And Governance

Status legend: IMPLEMENTED, VERIFIED, DOCUMENTED, NOT VERIFIED, EXTERNAL REVIEW REQUIRED, POLICY DECISION REQUIRED.

## Scope

Phase 17 hardens production security and governance for the existing modular monolith. It does not redesign UI, start Phase 18, claim legal compliance, or claim an independent penetration test.

Base: `origin/main` verified at `e599b5d` (`Phase 16: add OCR and AI quality evaluation (#17)`).

## Security Architecture

Primary runtime:

- Browser to Next web app to API to PostgreSQL.
- API to Redis/BullMQ to worker.
- API and worker to private S3-compatible object storage.
- Worker to ClamAV.
- Worker to Gemini only when provider configuration and key are supplied.

Core controls are server-derived sessions, HttpOnly cookies, SameSite CSRF, credentialed CORS restricted to `WEB_ORIGIN`, organisation-scoped RBAC, private object keys, malware scanning before promotion, short-lived signed downloads, immutable workflow records, tenant-scoped RAG queries, citation validation, and redacted logs.

## Threat Model

| Threat                              | Affected asset                                                                 | Boundary                              | Current mitigation                                                                                         | Phase 17 improvement                                                                     | Residual risk                                                           | Evidence                                           |
| ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| Horizontal tenant escalation / IDOR | Organisation, tenders, documents, extraction, RAG, drafts, readiness, packages | Browser/API/PostgreSQL                | `AccessGuard` derives membership from session and every service repeats `organisationId` predicates        | Added security suite covering cross-tenant selectors and server-derived authority        | Complex future endpoints can regress                                    | `pnpm test:security`                               |
| Vertical privilege escalation       | Memberships, approvals, download grants                                        | Browser/API                           | Role matrix in `@tender/domain`; Platform Admin is not an organisation role                                | Added Platform Admin/no implicit tenant tests and client-supplied role override tests    | Support features added later need review                                | `apps/api/test/security.test.ts`                   |
| Cross-tenant object access          | Private source files, package artifacts                                        | API/MinIO                             | Opaque object keys, `organisationId` predicates, signed URL issuance after authorization                   | Added controlled-package grant/redeem negative tests                                     | Presigned URLs remain reusable until expiry                             | `apps/api/test/controlled-review-packages.test.ts` |
| Temporary upload promotion          | Tender/company documents                                                       | API/Worker/MinIO/ClamAV               | Completion checks size/type/checksum metadata; worker scans before promotion                               | Documented as release invariant                                                          | ClamAV signature freshness is deployment responsibility                 | `apps/api/test/documents.test.ts`, worker tests    |
| Stale/revoked download authority    | Controlled packages                                                            | API/PostgreSQL/MinIO                  | Freshness, current-run, approval, artifact, checksum, malware, expiry checks before URL signing            | Added expired grant negative test                                                        | One-minute signed URL is not single-use                                 | `apps/api/test/controlled-review-packages.test.ts` |
| Prompt injection                    | Extracted text, RAG context, drafts                                            | Worker/provider                       | Source text is treated as inert; model output citation handles are verified                                | Added security tests for inert prompt wording and unsafe draft instructions              | Provider-backed adversarial behavior requires live-key test             | `apps/worker/test/rag-security.test.ts`            |
| RAG cross-tenant contamination      | Embeddings, chunks, citations                                                  | Worker/PostgreSQL/provider            | Authorised CTE filters organisation/tender/version/index/source class before ranking                       | Security suite asserts hard predicates before ranking                                    | Future query rewrites need review                                       | `apps/worker/test/rag-security.test.ts`            |
| Provider data leakage               | Source text, user questions, draft prompts                                     | Worker/provider                       | No sessions, passwords, storage keys, object keys or unrelated tenant data are used in prompts             | Provider egress inventory and disabled provider mode documented/tested                   | Contract terms cannot be proven in code                                 | This document, config tests                        |
| Secret leakage                      | Credentials, keys, URLs                                                        | Runtime/logs/audit/CI                 | Config parser reports paths/messages, not values; logs redact known sensitive headers                      | Production placeholder rejection added                                                   | External secret store integration is deployment responsibility          | `packages/config/test/environment.test.ts`         |
| Queue payload manipulation          | Worker jobs                                                                    | API/Redis/Worker                      | Job payloads carry opaque run ids, organisation id and request id, then workers reload authoritative state | Existing controlled package tests assert no source contents/object keys in queue payload | Redis access control is deployment responsibility                       | `apps/api/test/controlled-review-packages.test.ts` |
| Backup leakage                      | PostgreSQL/object backups                                                      | Database/object store/export location | No production backup service is encoded                                                                    | Local synthetic backup/restore runbook added                                             | Encryption, retention, access and audit are deployment responsibilities | Backup section below                               |
| Dependency compromise               | Runtime packages                                                               | CI/package manager                    | Lockfile, Dependency Review, audit baseline                                                                | Security document records unresolved advisories                                          | Upstream fixes needed for some transitive packages                      | `pnpm audit --prod`                                |

## Tenant Isolation Model

IMPLEMENTED: organisation route ids are selectors only. The session cookie supplies the actor. `AccessGuard` loads active membership by `organisationId`, `userId`, and `revokedAt: null`; services repeat tenant predicates in database reads/writes.

VERIFIED: deterministic security tests cover unauthenticated requests, cross-organisation selectors, Platform Admin without membership, client-supplied authority override attempts, document downloads, tender/RAG/package cross-tenant access, controlled download grants, and tenant-scoped RAG/draft SQL.

DOCUMENTED: major tenant-scoped families are organisations/memberships, company documents/evidence, tenders/documents/jobs, extraction, risk, eligibility, checklist, RAG, drafting, final readiness, controlled packages, reviews, approvals, and grants.

## Object Storage Security

IMPLEMENTED: source and package objects are private. User filenames never become authoritative object keys. Upload completion validates object size, type, and checksum metadata. Worker promotion happens after malware scanning. Download URLs are issued only after current authorization checks and expire in 60 seconds.

NOT VERIFIED: production bucket policy, encryption-at-rest, object lock, access logs, and replication are deployment controls.

## Provider Data Egress

Embeddings: outbound text is authorised RAG chunk text or query text. No session token, password, database URL, storage credential, object key, or unrelated tenant data is sent intentionally.

RAG answer generation: outbound data is user question plus retrieved authorised chunks labelled with local handles. Database ids and object keys are not needed in prompt context.

Draft generation: outbound data is section plan, approved human writing instructions when safe, and snapshotted authorised chunks with handles/source classes.

IMPLEMENTED: `RAG_PROVIDER=disabled` and `DRAFT_PROVIDER=disabled` are explicit configuration values. Missing or disabled provider egress fails closed without a silent fallback.

EXTERNAL VERIFICATION REQUIRED: provider training use, retention, deletion behavior, residency, subprocessors, breach terms, security terms, and permitted data classifications.

## Production Configuration

IMPLEMENTED: production config rejects placeholder secrets, local HTTP browser/object endpoints, insecure session cookies, and missing trusted proxy acknowledgement. Provider keys are required in production only when provider egress is enabled.

DOCUMENTED: Node does not terminate public TLS. Production is expected to be `Internet -> TLS termination / trusted reverse proxy -> web/API`. `TRUST_PROXY=true` is a production acknowledgement that only trusted reverse-proxy forwarded headers reach the services.

## Security Headers

IMPLEMENTED: API uses Helmet/Fastify security headers including frame, content-type, referrer and HSTS behavior. Web uses Next defaults. CSP remains a Phase 18/deployment hardening item because it must be designed with the final UI/assets to avoid unsafe wildcard policies.

NOT VERIFIED: real public-host TLS/HSTS behavior.

## Session And Authentication

IMPLEMENTED: opaque database-backed sessions, hashed stored tokens, HttpOnly cookies, SameSite Strict, Secure cookies in production, CSRF double-submit tokens, origin checks, rate limiting, password hashing with scrypt, reset/invitation token expiries, logout and revocation.

VERIFIED: existing and Phase 17 tests cover cookie flags, CSRF, revoked sessions, rate limits, unauthenticated failure, and role boundaries.

## Secret Inventory And Rotation

Secret configuration: `DATABASE_URL`, Redis credentials if embedded in `REDIS_URL`, `COOKIE_SECRET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `GEMINI_API_KEY`, `EMAIL_DELIVERY_TOKEN`, local PostgreSQL/MinIO bootstrap passwords.

Non-secret configuration: hosts, ports, bucket names, regions, queue names, TTLs, rate limits, provider/model names, log levels.

Public frontend configuration: `NEXT_PUBLIC_API_URL` only.

Rotation status:

- Database, Redis, object storage, email and provider credentials: external service rotation procedure; service restart may be required.
- `COOKIE_SECRET`: rotation requires restart and currently has no dual-key overlap.
- Session, password-reset, and invitation token expiry and revocation are enforced through database state.
- TLS certificates: external reverse proxy responsibility.

## Data Inventory

| Data category                | Storage                                        | Tenant scope                 | Sensitivity               | External transmission                               | Owner               |
| ---------------------------- | ---------------------------------------------- | ---------------------------- | ------------------------- | --------------------------------------------------- | ------------------- |
| Account/contact data         | PostgreSQL                                     | User/global plus memberships | Sensitive                 | Email provider for notifications                    | Product/security    |
| Organisation memberships     | PostgreSQL                                     | Organisation                 | Sensitive authority data  | No                                                  | Product/security    |
| Tender source files          | Private object storage, metadata in PostgreSQL | Organisation/tender          | Sensitive                 | OCR/provider only through derived text when enabled | Product/security    |
| Company evidence             | Object storage/PostgreSQL                      | Organisation                 | Sensitive                 | RAG/draft provider when enabled                     | Product/security    |
| Extracted/OCR text           | PostgreSQL                                     | Organisation/tender          | Sensitive                 | RAG/draft provider when enabled                     | Product/security    |
| Embeddings/chunks            | PostgreSQL vector/chunk tables                 | Organisation/tender/index    | Sensitive derived data    | Embedding provider when enabled                     | Product/security    |
| Answers/drafts               | PostgreSQL                                     | Organisation/tender          | Sensitive generated data  | Provider when enabled                               | Product/security    |
| Audit events                 | PostgreSQL                                     | Organisation/global          | Security/business record  | No                                                  | Security            |
| Controlled package artifacts | Private object storage/PostgreSQL              | Organisation/tender          | Sensitive export artifact | Signed URL to authorised user                       | Product/security    |
| Logs/metrics                 | Runtime telemetry                              | Service/request              | Sensitive metadata        | Deployment telemetry if configured                  | Operations          |
| Backups                      | Deployment backup storage                      | Cross-tenant                 | Highly sensitive          | No except backup platform                           | Operations/security |

## Retention And Deletion

POLICY DECISION REQUIRED: approved retention periods for tender sources, company evidence, generated artifacts, logs, metrics, backups, and immutable business/audit records.

IMPLEMENTED technical distinctions:

- Sessions, reset tokens and invitation tokens have explicit TTL/revocation.
- Some user-controlled records support soft deletion (`deletedAt` or status).
- Audit/security/business history is append-only and is not removed by ordinary user-controlled deletion.
- Temporary uploads have expiry metadata and must not be promoted without validation.

Deletion dependency map: tenders own versions, documents, extraction/risk/checklist/RAG/draft/readiness/package histories; documents own object storage artifacts and access events; package grants depend on package artifacts/runs. No destructive organisation-wide deletion endpoint is added in Phase 17.

## Backup And Restore Runbook

PostgreSQL local verification:

1. Create synthetic data in the active database.
2. Run `pg_dump` from the container or installed PostgreSQL client.
3. Verify dump size is non-zero.
4. Restore into a separate temporary database, never over the active database.
5. Compare representative row counts/checksums and organisation ids.

Object storage local verification:

1. Export/copy a synthetic private object to a temporary local or temporary bucket target.
2. Verify SHA-256 checksum before and after.
3. Confirm restored objects remain private and are not public HTTP objects.

Cross-store consistency: PostgreSQL and object storage are not atomically backed up by this repository. Production needs coordinated snapshots or a documented consistency window.

RPO/RTO: ENGINEERING TARGET - TBD. Local restore duration can be recorded as evidence only, not a contractual target.

Backup security requirements: private backup access, deployment-layer encryption, least-privilege credentials, restoration authorization, retention, deletion, and auditability. Local Docker validation does not prove production encryption.

## Dependency Risk

Baseline `pnpm audit --prod` on Phase 17 start:

- `brace-expansion` high via API Fastify/static Swagger path.
- `nanoid` high via Next/PostCSS.
- `postcss` moderate via Next.

Safe remediation was not applied because the advisories are transitive through pinned framework packages. Dependency Review and audit remain active; planned mitigation is framework/transitive upgrade when compatible.

## Pen-Test And External Review

Prepared: [PEN_TEST_READINESS.md](PEN_TEST_READINESS.md).

NOT PERFORMED - EXTERNAL SECURITY ASSESSMENT REQUIRED.

LEGAL REVIEW REQUIRED: DPDP/CERT-In/procurement/legal compliance claims are not made by this repository.

SECURITY REVIEW REQUIRED: independent penetration test, production cloud/storage/IAM review, TLS/proxy validation, backup encryption/restore authorization, and provider contract review.

## Phase 18 Boundary

DOCUMENTED: no UI redesign is included. Phase 18 remains the place for final product-redesign/pilot UI integration.
