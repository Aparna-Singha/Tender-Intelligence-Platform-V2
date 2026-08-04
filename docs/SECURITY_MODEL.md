# Security Model

## Phase 10.5 web presentation controls

- Route organisation IDs remain selectors; cookies and server-derived memberships
  remain the authority.
- Browser API errors expose only safe messages, status, machine code and bounded
  request IDs. Malformed or non-JSON responses do not expose internals.
- CSRF acquisition, HttpOnly cookie authentication and credentialed requests are
  preserved, with one safe refresh retry for an unsafe request rejected by `403`.
- Signed URLs, document content, prompts, RAG answers and draft bodies are not
  added to telemetry.

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

## Early risk-analysis isolation

Risk jobs carry opaque IDs and reload extraction data with organisation, tender,
version, and run scope. Rules never access company-profile or company-vault tables.
Tender instructions remain inert data; there is no URL fetch, model, tool, approval,
export, or submission capability. Citation ownership, extraction identity, excerpt,
and checksum are validated before completion.

## Phase 7 evidence isolation

Phase 7 repeats organisation scope for runs, snapshots, requirements, documents,
facts, citations, links, reviews, SSE, and signed source opening. Browser IDs are
selectors, never authority. Queue messages and progress events contain safe IDs,
counts, stages, and versions only. Tender wording, profile values, document
excerpts, private keys, and signed URLs are excluded from logs and events.

## Phase 8 checklist isolation

Checklist generation and every run, item, assignment, source, history, and SSE query
repeat organisation and tender scope. Assignees must be active members of the same
organisation. Browser IDs remain selectors, never authority. Workers reload the
active Phase 7 run and exact snapshot before committing, process opaque queue
identifiers with bounded retries, concurrency, and time, and cannot resolve or
dismiss items. Filenames, tender text, evidence excerpts, and notes remain inert
untrusted data; Phase 8 has no URL fetching, model or tool execution, permission
change, notification, export, or submission capability. Safe telemetry excludes
company and tender content.

## Phase 9 retrieval isolation

Opaque RAG jobs reload organisation, tender, version, extraction, index, and source
mode from PostgreSQL. SQL applies tenant and source-class predicates before
ranking; post-filtering is prohibited. Company evidence is excluded by default and
requires explicit permission.

Retrieved text is inert. The provider has no web, storage, permission, export,
approval, or submission tool. Unknown citation handles, invalid output, provider
failure, and embedding mismatch fail closed. Logs, queues, SSE, metrics, and errors
exclude questions, answers, prompts, passages, and embeddings. Provider privacy and
regional-processing approval remain production blockers.

## Phase 10 drafting isolation

Draft endpoints derive actor and organisation from the secure session and repeat
organisation/tender scope on reads, mutations, template access, evidence use,
review, and SSE. Platform administrators receive no implicit tenant membership.
Opaque jobs reload PostgreSQL authority and require a current unsuperseded
`CONTINUE` before generation and persistence.

Retrieval is bounded and pre-filtered by organisation, tender, tender version,
active index, and snapshotted source IDs. Chat answers never enter the snapshot.
Retrieved text, templates, and human input are inert; the provider has no tools,
internet, approval, export, or submission capability. Unknown handles, unsupported
company facts, cancellation, stale sources, and provider errors fail closed.
Telemetry excludes source, prompt, draft, and human-input bodies.

## Phase 11 final-readiness security boundary

Phase 11 is implemented and merged. Its preflight is informational and
cannot bypass the serializable start transaction. Start, reads, worker processing,
source access, finding review, and final disposition repeat organisation,
tender, version, run, snapshot, finding, and source predicates. Browser-provided
organisation IDs remain selectors checked against server-derived membership, and
`PLATFORM_ADMIN` receives no implicit tenant access.

Idempotency keys, database uniqueness, bounded serialization retry, and complete
fingerprint checks prevent duplicate starts and stale activation. The worker receives
opaque identifiers only, reloads every source, and never records a human decision,
exports, or submits. Source, evidence, prompt, draft, and finding bodies are excluded
from queue payloads, logs, SSE, and audit metadata.

Only an `OWNER`, `ADMIN`, or `REVIEWER` with an explicit decision permission may
record the final disposition, and that actor must differ from both the run requester
and consolidated-draft creator. There is no single-user bypass. The decision
transaction rechecks current pointers, both run statuses, invalidation, fingerprint,
provenance, findings, acknowledgements, authority, and separation of duties.

Draft approval enforces `DraftTemplateVersion.requiredReviewRole` and preserves
role-at-approval evidence from authenticated membership.
Existing unverifiable approvals cannot satisfy Phase 11. Read-time stale detection
is mandatory even when write paths eagerly invalidate affected runs. See
[Final Readiness Policy](FINAL_READINESS_POLICY.md).

## Phase 12 controlled-package security boundary

Phase 12 is designed but not implemented. It will preserve server-derived tenant and
role authority, immutable snapshots, fail-closed freshness, opaque queue payloads,
private object storage, malware scanning, bounded public errors, and redacted logs.
Final package bytes must be passive, bounded, checksummed, scanned, and atomically
promoted before a package can enter review. Object keys and signed URLs never enter
public package metadata or generic logs.

Download authorisation is distinct from generation: only an approved, current,
non-revoked package may receive a one-minute signed URL after a fresh tenant,
permission, fingerprint, artifact, checksum, and approval recheck. Platform
Administrator has no implicit tenant authority. See
[Controlled Review-Package File Security](CONTROLLED_REVIEW_PACKAGE_SECURITY.md) and
[Controlled Review-Package Export Policy](CONTROLLED_REVIEW_PACKAGE_POLICY.md).
