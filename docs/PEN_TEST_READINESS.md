# Pen-Test Readiness

NOT PERFORMED - EXTERNAL SECURITY ASSESSMENT REQUIRED.

This package prepares an independent tester. It is not an attestation, certification, or legal-compliance claim.

## Architecture Overview

Tender Intelligence Platform is a TypeScript modular monolith with:

- Next web app.
- Nest/Fastify API.
- PostgreSQL as source of truth.
- Redis/BullMQ queue.
- Worker for malware scanning, extraction/OCR, RAG, drafting, readiness and controlled package work.
- Private S3-compatible object storage.
- ClamAV for malware scanning.
- Optional Gemini provider egress for embeddings, RAG answers and draft generation.

## Trust Boundaries

- Browser -> Web/API.
- API -> PostgreSQL.
- API -> Redis/BullMQ -> Worker.
- API/Worker -> S3-compatible storage.
- Worker -> ClamAV.
- Worker -> external AI provider when enabled.
- Production Internet -> TLS termination/trusted reverse proxy -> web/API.

## Authentication Model

Opaque database-backed session tokens are stored only as digests. Session cookies are HttpOnly, SameSite Strict, and Secure in production. Unsafe requests require configured origin plus CSRF token. Passwords use scrypt hashing. Reset/invitation tokens are bounded by TTL.

## Tenant And Role Model

Organisation ids in routes are selectors. The server derives actor identity from the session and checks active membership in PostgreSQL. Roles are `OWNER`, `ADMIN`, `TENDER_EXECUTIVE`, `CONSULTANT`, and `REVIEWER`. `PLATFORM_ADMIN` is not an organisation role and has no implicit tenant visibility.

## Feature Families

Major API families include organisations/memberships, onboarding/company profile, company documents/evidence, tender workspaces/documents/jobs, extraction, risk analysis, eligibility, checklist, RAG, drafting, final readiness, controlled review packages, approvals/reviews, and signed download grants.

## Object Storage And Downloads

Objects are private and keyed by server-generated object keys. Uploads start in quarantine, are validated by metadata/checksum/type, scanned by ClamAV, and only then promoted. Controlled-package downloads use purpose-bound 60-second presigned URLs after fresh authorisation, approval, artifact integrity and malware checks. URLs are reusable until expiry; they are not claimed to be single-use.

## RAG And Provider Boundary

RAG chunks are stored with organisation/tender/version/index/source-class fields. SQL uses an authorised CTE with tenant predicates before ranking. Provider prompts include authorised source text and user question/draft plan only; they intentionally omit session tokens, passwords, storage credentials, database URLs, object keys and unrelated tenant data.

## Known Advisories

Current production audit baseline contains unresolved transitive advisories in `brace-expansion`, `nanoid`, and `postcss`. Review current `pnpm audit --prod` output before testing.

## Known Limitations

- Provider contract, retention, training use, residency and deletion terms require external verification.
- Retention periods and deletion policy are not fully approved.
- Production TLS/proxy/storage/IAM/backups cannot be proven by local Docker.
- Independent penetration testing has not been performed.
- CSP is not finalized for the Phase 18 UI.

## Tester Checklist

- Authentication/session: cookie flags, fixation, expiry, revocation, reset/invitation expiry, brute-force/rate-limit behavior.
- Authorization/IDOR: every organisation-scoped endpoint with swapped ids, stale ids, deleted records, guessed ids, and non-member users.
- Role escalation: reviewer/admin/consultant/executive boundaries, client-supplied role/user ids, same-actor approval restrictions.
- Object storage: upload metadata tampering, malware failure, direct object access, cross-tenant grant/redeem, expired grant, revoked/superseded package.
- Parser/upload security: file type confusion, zip/path tricks, OCR/decompression bounds, prompt-injection content in documents.
- Injection: Zod validation, SQL parameterization, SSE/event data, filenames/content disposition.
- CSRF/CORS: configured origin only, credentials handling, unsafe methods.
- Business logic: duplicate/replayed idempotency keys, stale approvals, freshness invalidation, queue replay.
- RAG/prompt injection: cross-tenant retrieval, invented handles, unsupported citations, malicious source instructions.
- Sensitive-data exposure: logs, errors, metrics, audit metadata, provider prompts, PR/build artifacts.
