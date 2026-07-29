# Security Model

## Objectives

The platform must preserve organisation isolation, document confidentiality, data
integrity, traceability, service availability, and human control over high-stakes
outcomes.

This threat model includes the Phase 1B identity controls. It must be reviewed
again before production launch.

## Protected assets

- identities, sessions, memberships, and permissions;
- company profiles and reusable evidence;
- tender files, extracted text, embeddings, findings, drafts, and exports;
- citations, decisions, approvals, and audit records;
- API, storage, database, queue, and LLM credentials;
- operational telemetry, backups, and recovery material.

## Trust boundaries and threats

| Boundary              | Representative threats                                       | Required controls                                                                 |
| --------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Browser to API        | Session theft, CSRF, injection, broken access control        | Secure session design, CSRF protection, validation, authorization, rate limiting  |
| Organisation boundary | IDOR, cross-tenant search or cache leakage                   | Server-side tenant scoping, policy tests, scoped cache keys, deny by default      |
| Upload to processing  | Malware, decompression bombs, spoofed files, parser exploits | Size/type limits, quarantine, scanning, safe extraction, sandboxing, timeouts     |
| API to storage        | Public objects, guessed keys, overbroad credentials          | Private buckets, opaque keys, least privilege, short-lived signed URLs            |
| Queue and workers     | Forged jobs, replay, poisoned payloads                       | Authenticated transport, minimal payloads, idempotency, schema validation         |
| Retrieval to LLM      | Prompt injection, data exfiltration, cross-tenant context    | Authorized retrieval, content isolation, instruction hierarchy, output validation |
| Staff operations      | Privilege abuse, accidental disclosure                       | Separate admin plane, just-in-time access, audit logs, approval and alerts        |
| Dependencies and CI   | Supply-chain compromise, secret leakage                      | Lockfiles, review, scanning, protected CI secrets, provenance and patching        |

## Identity and authorization

Authentication uses opaque, database-backed sessions as recorded in
[ADR 0007](adr/0007-database-sessions-and-csrf.md). Only a digest is persisted.
The session cookie is HttpOnly, Secure in production, and SameSite=Strict. Unsafe
requests require the configured Origin and a signed double-submit CSRF token.
Passwords use scrypt. Authentication throttles are atomic in Redis and fail closed.

Authorization is
enforced on every server-side operation using both actor and organisation context.
Object IDs are not authorization. Sensitive actions require recent authentication
or step-up controls when justified.

Routes deny access unless explicitly marked public, authenticated, or assigned an
organisation permission. The API derives user and session from the cookie and then
loads membership from PostgreSQL. Submitted `user_id`, `profile_id`, or
`organisation_id` values never establish authority. Platform administrator is not
an implicit tenant role. Owner is the only role that can change member roles; no
actor can change their own membership or assign Owner/Platform Administrator
through this API.

Membership invitations, role changes, support access, export, deletion, and security
configuration changes generate audit events. Automated tests must exercise horizontal
and vertical privilege escalation attempts.

Phase 1B audit events cover successful and failed login, logout, organisation
creation, invitation creation/acceptance, role change, session revocation, and
password reset completion. Audit metadata contains hashes rather than raw attempted
emails or network identifiers where applicable.

Phase 2 onboarding reads and writes use the same organisation permission guard.
The authenticated session supplies the user; URL organisation identifiers remain
selectors checked against membership. Autosave payloads cannot supply an
authoritative user or tenant ID. Step payloads are allowlisted by Zod and audit
metadata records changed field names, never sensitive business values. Profile
readers receive only data from the authorised organisation.

Phase 3 upload and download routes use document-specific organisation permissions.
Client identifiers select records only after the guard derives the authenticated
member, and each repository query repeats the organisation scope. Presigned URLs
are purpose-bound to one opaque key and expire after five minutes for upload or one
minute for download by default. User filenames never form object keys. Completion
independently checks stored byte count, declared MIME, and checksum metadata before
enqueueing processing.

## Data protection

- TLS protects data in transit; managed encryption protects databases, objects,
  backups, and queues at rest.
- Secrets live in an approved secrets manager and rotate independently of builds.
- Private object storage blocks public access. Signed links are short-lived and
  issued only after authorization.
- Logs, metrics, traces, and error responses exclude credentials, document content,
  prompts, embeddings, and unnecessary personal data.
- Backups are encrypted, access-controlled, restoration-tested, and covered by
  retention and deletion policy.
- Production data is not copied into development or test environments.

Exact retention periods, recovery objectives, residency requirements, and key
management choices remain launch-blocking decisions.

## Secure file pipeline

Uploads enter quarantine with server-generated identifiers. The platform enforces
allowlisted types, byte and expanded-size limits, archive depth and member limits,
filename normalization, malware scanning, parser isolation, and processing timeouts.
A file is unavailable to downstream AI processing until it passes policy.

PDF active content and external references are not trusted. ZIP paths cannot escape
the extraction area. Failed or suspicious inputs are isolated and reported without
executing or rendering unsafe content.

The company vault accepts PDF, JPEG, PNG, DOCX, and XLSX up to 25 MiB and 500 active
logical documents per organisation. The worker verifies SHA-256 and content-sniffed
MIME against the allowlisted extension before malware scanning. Scanner errors fail
closed in quarantine. Rejected and quarantined objects never receive signed
downloads. Document bytes, signed URLs, checksums, and extracted contents are
excluded from logs. Archive upload is deliberately excluded from this vault phase.
Workers process at most two document jobs concurrently and enforce an abort-aware
60-second default deadline. The worker rechecks the object-reported byte count
before its bounded read, and checks cancellation after type detection, scanning,
and storage operations so timed-out work cannot later mark a document `READY`.

Tender sources reuse the private-storage and scanner controls. Queries repeat the
organisation predicate after the permission guard, and only a `READY` source can
receive a short-lived download. PDF, ZIP, XLSX, DOCX, and CSV are limited to 25
MiB. ZIP metadata is inspected without extraction; traversal, nested archives,
more than 200 entries, more than 100 MiB total expansion, entries above 50 MiB,
and ratios above 100:1 fail closed. Cancellation is checked before promotion, and
no failure path marks a document safe.

## AI-specific controls

Tender text, company documents, URLs, OCR output, and retrieved passages are data,
not instructions. Retrieval is authorised and tender-scoped before any model call.
Tools exposed to models are allowlisted and least-privilege; model output cannot
directly submit bids, change permissions, approve reviews, or export packages.

Structured outputs are schema-validated. Important findings require verifiable
citations. Ambiguous compliance questions and unsupported answers are routed to human
review or refused. Provider data use, retention, and regional processing terms must
be approved before production.

See [RAG Policy](RAG_POLICY.md).

## Audit and monitoring

Audit events capture actor, organisation, action, target, result, timestamp,
correlation ID, and relevant version identifiers without copying sensitive content.
Security monitoring covers authentication anomalies, authorization denials, unusual
downloads, support access, malware detections, prompt-injection signals, citation
failures, and administrative changes.

Audit storage must be tamper-evident or append-oriented with restricted access and a
defined retention policy.

## Security verification

Required verification includes:

- unit tests for policy and state transitions;
- integration tests for tenant isolation, role boundaries, signed-object access, and
  deletion;
- malicious upload and archive test cases;
- prompt-injection and cross-tenant retrieval evaluations;
- dependency, secret, static analysis, and container scanning in CI;
- backup restoration, incident response, and access review exercises;
- independent security assessment before production.

## Incident response

Maintain privately accessible procedures for triage, containment, evidence
preservation, credential rotation, customer and regulatory assessment, recovery, and
post-incident review. Public vulnerability reporting guidance is in
[`SECURITY.md`](../SECURITY.md).

## Tender parser isolation

Phase 5 parsers enforce bounded object reads, page/sheet/row/cell/archive limits,
job timeouts, and queue concurrency. OOXML rejects document type declarations;
spreadsheet formulas remain neutralised, untrusted text. ZIP traversal, nested
archives, and decompression bombs remain prohibited. Every query carries the
authenticated organisation scope and source downloads are re-authorised. Raw
source content is excluded from queue payloads and logs. Citation validation fails
closed before a run can become complete.
