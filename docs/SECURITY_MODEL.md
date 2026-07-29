# Security Model

## Objectives

The platform must preserve organisation isolation, document confidentiality, data
integrity, traceability, service availability, and human control over high-stakes
outcomes.

This is an initial threat model. It must be reviewed before implementation and
production launch.

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

Authentication design will be selected in an implementation ADR. Authorization is
enforced on every server-side operation using both actor and organisation context.
Object IDs are not authorization. Sensitive actions require recent authentication
or step-up controls when justified.

Membership invitations, role changes, support access, export, deletion, and security
configuration changes generate audit events. Automated tests must exercise horizontal
and vertical privilege escalation attempts.

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
