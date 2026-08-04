# Controlled Review-Package File Security

Status: Phase 12 renderer, worker, API and web controls are implemented on the Draft
feature branch; final real-stack and browser validation remains pending.

The passive PDF renderer is exactly pinned to `pdf-lib` 1.17.1 (MIT), uses no
browser/native executable or network resource, fixes document metadata and layout,
and fails closed when the embedded standard font cannot encode approved text
exactly. V1 makes no PDF/A claim. The worker produces the locked four-member ZIP,
uses the acyclic checksum design, verifies member and final ZIP integrity, uploads
through opaque private temporary keys, requires a clean ClamAV result, and promotes
before a serializable database activation. Download grants redeem to a purpose-bound
presigned URL with a maximum 60-second lifetime; URLs are reusable until expiry and
are not stored or logged. No download-completion event is claimed without storage
telemetry.

This threat model supplements [Security Model](SECURITY_MODEL.md) and the
[Controlled Review-Package Policy](CONTROLLED_REVIEW_PACKAGE_POLICY.md).

## Trust boundaries

Approved draft text, source filenames, citations, uploaded documents, templates,
manifest fields, renderer output, archive entries, object metadata, queue payloads,
and download selectors are untrusted until validated. PostgreSQL owns authority;
private object storage owns bytes; Redis only transports opaque work identifiers.

## File-generation controls

| Threat                                    | Required fail-closed control                                                                                     | Measurable verification                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Path traversal / ZIP Slip                 | Generate from an allowlisted logical file table; reject separators, `..`, absolute paths and drive prefixes      | Corpus rejects POSIX/Windows traversal; extraction remains inside a temporary root |
| ZIP/decompression bomb                    | No nested archives; exactly 4 files, 100 MiB total, 50 MiB/file and ratio at most 100:1                          | Boundary and over-limit tests fail before promotion                                |
| Duplicate/case-colliding entries          | Normalise then require unique case-folded names                                                                  | Duplicate Unicode/case fixtures rejected                                           |
| Unsafe Unicode/reserved names             | NFKC normalisation, ASCII-safe generated names, reject controls/bidi markers and Windows device names            | Cross-platform filename corpus passes                                              |
| Overlong names                            | Maximum 120 UTF-8 bytes and bounded full key length                                                              | Exact-boundary tests                                                               |
| MIME/extension confusion                  | Renderer-owned extension plus byte sniffing; exact allowlist                                                     | Mismatch never reaches `GENERATED`                                                 |
| PDF JavaScript, actions or embedded files | Generator API forbids active objects, attachments, launch actions, forms and remote resources; inspect final PDF | Binary inspection corpus confirms absence                                          |
| DOCX macros/external relationships        | DOCX excluded from v1                                                                                            | No DOCX artifact or MIME accepted                                                  |
| Remote images/fonts/links                 | Template permits no remote resource; text URLs are inert and not made active                                     | Network-disabled generation and structural inspection                              |
| Embedded executables                      | Allowlisted generated artifact types and ZIP entries only                                                        | Executable signatures/extensions rejected                                          |
| CSV/formula injection                     | CSV excluded; JSON strings remain data                                                                           | No CSV artifact generated                                                          |
| Malicious source attachment               | Raw attachments excluded; any future selected binary must already be READY and be rescanned                      | Unsafe/quarantined state blocks start or generation                                |
| Malware-scan bypass                       | Scan exact final bytes after rendering and before promotion; scanner error fails closed                          | Clean/infected/error integration tests                                             |
| Object substitution                       | Conditional upload/promotion, object metadata size, SHA-256 and opaque run-specific key checks                   | Changed object cannot activate or download                                         |
| Incomplete upload                         | Temporary object state until verified; database activation is last                                               | Interrupted upload leaves no active artifact                                       |
| Cross-tenant leakage                      | Permission guard plus repeated organisation/tender/run/artifact predicates                                       | Forged selector tests return bounded 403/404                                       |
| Stale/replayed link                       | One-minute purpose-bound URL issued only after freshness/approval recheck                                        | Stale/revoked/expired tests cannot issue or reuse beyond expiry                    |
| Queue/log leakage                         | Opaque IDs only; structured redaction                                                                            | Source/draft/evidence/object/signed-URL canaries absent from logs and job bodies   |
| Resource exhaustion                       | Bounded records, pages, bytes, time, concurrency and temporary disk; cancellation checks                         | Limit and timeout tests terminate safely                                           |

## Temporary processing

Each job receives a new restricted temporary directory. Paths are joined only from
server-generated names and verified to remain below that directory. The worker
opens files without following symlinks, writes with exclusive creation, enforces a
per-job byte budget, and deletes the directory in `finally`. Startup reconciliation
removes abandoned directories older than the approved operational threshold.

The renderer has no network access or credentials beyond least-privilege access to
its exact input and run prefix. It does not execute office software, shell commands,
macros, HTML, source hyperlinks, or embedded code. Timeouts and queue concurrency
follow existing worker conventions and gain Phase 12-specific configuration bounds.

## Storage integrity

Workers upload to a run-scoped temporary key, verify reported length and SHA-256,
scan the exact final bytes, then promote with conditional semantics. PostgreSQL is
updated to `GENERATED` only after promotion is verified. A reconciliation process
compares nonterminal rows and temporary objects without exposing keys in logs.

The API rechecks tenant scope, current pointer, freshness, review approval, artifact
state, scan result, byte count and checksum before issuing a link. Response metadata
uses the stored safe filename and exact MIME type. Public APIs return artifact IDs,
not keys.

## Security tests required

- filename, Unicode, reserved-name, path and duplicate-entry corpus;
- oversized logical input, PDF, ZIP member, package and compression-ratio cases;
- malformed PDF and active-content structural inspection;
- infected, scanner-timeout and scanner-unavailable final artifacts;
- interrupted uploads, substituted objects and checksum mismatches;
- duplicate queue delivery, cancellation and timeout after upload;
- cross-tenant and cross-tender selectors at every package endpoint;
- stale authority, revoked approval and expired download grants;
- log, audit, queue and error canary-leak tests; and
- Windows and Ubuntu generation with byte/checksum comparison for canonical inputs.

## Operational limitations

ClamAV reduces known-malware risk but is not proof that a file is safe. SHA-256
detects byte changes but is not a digital signature. A presigned URL is not
single-use. Direct storage download completion is observable only when storage
access telemetry is configured. These limitations must remain visible in operations
and review guidance.
