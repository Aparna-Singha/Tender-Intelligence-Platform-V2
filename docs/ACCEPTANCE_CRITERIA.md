# Acceptance Criteria

## Milestone 0: Documentation contract

This documentation phase is accepted when:

- all files listed in the phase request exist and contain substantive, consistent
  guidance;
- the independent product name and non-affiliation disclaimer are prominent;
- all fixed users, inputs, journey steps, exclusions, eligibility states, AI rules,
  and architecture decisions are documented;
- both required risk-analysis gates are explicit;
- architecture and end-to-end workflow Mermaid diagrams are present;
- internal Markdown links resolve;
- configured Markdown linting passes, or the absence of a configured linter is
  recorded;
- no application package, runtime dependency, generated application scaffold,
  database migration, secret, or private document is added.

## Milestone 1: Measurable exit criteria

Milestone 1 is planned and not implemented in this phase. Before its release, all
criteria below must pass in a production-like environment using approved synthetic,
public, or licensed fixtures.

### Identity and organisation isolation

- 100% of tested cross-organisation API, object, search, conversation, and export
  access attempts are denied.
- 100% of privileged actions in the authorization test matrix enforce the documented
  role and organisation scope.
- Invitation, role change, support access, document download, review approval,
  readiness completion, export, and deletion actions produce attributable audit
  events.
- Session, CSRF, brute-force, and rate-limit controls pass the agreed security test
  suite.

### Ingestion and provenance

- The supported manual PDF, ZIP/annexure, corrigendum, official-URL metadata,
  demonstration-fixture, and administrator-import paths are clearly distinguishable.
- 100% of accepted files pass type, size, archive, and malware policy before parsing;
  known malicious and decompression-bomb fixtures are rejected or quarantined.
- At least 95% of pages in the agreed readable-PDF fixture set produce extractable,
  correctly ordered text; scanned or failed pages are visibly flagged rather than
  silently omitted.
- Every structured requirement and material finding retains document version, page,
  and clause when the source provides a clause label.
- Adding a corrigendum preserves the earlier source, records supersession or
  conflict, and invalidates affected downstream analysis.

### Analysis, evidence, and risk

- The immediate cited risk analysis completes after processing and is available
  before any draft-generation action is enabled.
- The final readiness audit performs a fresh second risk analysis using current
  documents, evidence, reviews, and corrigenda.
- 100% of material risk findings in the evaluation set contain a resolvable
  document, page, and clause citation; findings without support are not presented as
  established facts.
- Eligibility output uses only `verified`, `likely_met`, `missing`, `conflict`,
  `not_applicable`, and `human_review_required`.
- `verified`, `not_applicable`, conflict resolution, and blocking-risk disposition
  require the configured human action and retain rationale and version history.

### RAG and drafting quality

- On the approved evaluation set, at least 95% of answer citations resolve to the
  claimed source passage and at least 90% of supported factual claims are entailed by
  their cited context.
- At least 95% of deliberately unanswerable test questions receive an explicit
  insufficient-evidence response with no invented company fact.
- 100% of cross-tenant and cross-tender retrieval probes return no unauthorized
  passage.
- The prompt-injection suite demonstrates no unauthorized data disclosure, policy
  override, approval, export, or tool action.
- Drafts contain no asserted company fact outside approved evidence in the evaluation
  set; missing inputs remain explicit placeholders or review items.
- Every generated draft records source versions, model configuration, and review
  state, and cannot become approved without an authorized reviewer.

### Readiness and export

- Export is blocked until the final readiness audit completes and required human
  reviews and blocking dispositions are recorded.
- A new relevant document or corrigendum invalidates the prior readiness result and
  any not-yet-delivered export.
- Every package includes a manifest of tender document versions, evidence versions,
  findings, unresolved limitations, review actions, audit timestamp, and generated
  artifacts.
- An authorized user can verify all citations in the exported review package without
  receiving access to another organisation's data.
- The user interface and export carry the non-affiliation and no-guarantee language.

### Reliability, performance, and operations

- API contracts are published in OpenAPI and validated in CI.
- Formatting, linting, strict type-checking, unit, integration, security, and
  end-to-end tests pass in CI; production artifacts build reproducibly.
- At least 99% of valid ingestion jobs in the agreed load test complete or reach an
  explicit actionable failure state without duplicate authoritative records.
- For the agreed fixture size and test environment, p95 interactive API latency
  excluding long-running jobs is at most 500 ms, and job progress is visible within
  5 seconds. Model response latency is measured separately and surfaced honestly.
- Structured logs, metrics, and traces correlate requests and jobs while automated
  checks find no secrets or document bodies in telemetry.
- Backup restoration, deletion across derived stores, worker retry/idempotency, and
  incident-response exercises pass before production.

### Release evidence

The release record must identify fixture set and version, environment, test report,
known limitations, security review, data-retention decision, provider data-handling
approval, recovery objectives, and accountable human sign-off. A failed mandatory
criterion blocks release or requires a documented, time-bound risk acceptance by an
authorized owner.

## Phase 1A: Platform foundation

Phase 1A is accepted when:

- the required `apps`, `packages`, and `infrastructure` workspace structure exists;
- strict TypeScript, ESLint, Prettier, Vitest, Turborepo, and pnpm are reproducible
  from the lockfile;
- PostgreSQL, Redis, and private MinIO services have persistent local volumes and
  health checks;
- API and worker liveness responses use the standard success envelope;
- readiness checks exercise real PostgreSQL, Redis, queue, and applicable object
  storage dependencies;
- invalid environment values fail startup without logging secret values;
- unsafe request IDs are replaced, unexpected exceptions use safe error envelopes,
  and sensitive logging fields are redacted;
- API and worker shutdown close listeners and external clients;
- Prisma migrations are versioned and production deployment uses `migrate deploy`;
- CI checks formatting, linting, strict type-checking, tests, and builds;
- dependency review and secret scanning workflows exist;
- web, API, and worker production Dockerfiles run as non-root users;
- no authentication, tender business behavior, fake response, or persistent
  process-memory store is introduced.

## Phase 1B: Identity and organisation foundation

Phase 1B is accepted when:

- the requested identity, session, organisation, invitation, audit, onboarding
  progress, and company profile tables are created by a versioned migration;
- session and one-time token secrets are persisted only as digests, passwords are
  scrypt-hashed, and revoked sessions fail on their next request;
- browser authentication uses HttpOnly, SameSite=Strict cookies that are Secure in
  production, with no access or refresh token in localStorage;
- every unsafe browser request requires the exact configured Origin and a valid
  signed double-submit CSRF token;
- every route is explicitly public, authenticated, or organisation-authorised, with
  no implicit access and no implicit tenant access for Platform Administrator;
- cross-organisation selectors and altered request IDs cannot override the
  server-derived user and membership;
- self-promotion, Owner assignment, and Platform Administrator assignment through
  organisation membership endpoints are denied;
- registration, login, failed login, logout, organisation creation, invitation,
  role change, password reset, and session revocation behaviors create the
  documented audit events;
- authentication endpoint limits are atomic in Redis and fail closed;
- public errors do not disclose account existence, authorization state, or internal
  exception details;
- the generated OpenAPI contract and README accurately document the available
  endpoints and configuration;
- security unit tests, formatting, Markdown lint, ESLint, strict type-checking,
  tests, and all three production builds pass;
- no tender features or onboarding business questions are introduced.

## Phase 2: Progressive onboarding and structured profile

Phase 2 is accepted when:

- all eight specified steps are navigable independently and support resume,
  autosave, back, next, optional skipping, and later profile editing;
- beginner mode provides guidance and professional mode provides compact context;
- reseller, service-provider, and consultant conditional requirements are validated
  by both shared contracts and server-side policy;
- profile values are stored as typed rows with source, verification state, optional
  evidence reference, update time, and updater;
- annual turnover and document readiness use dedicated structured tables;
- no complete onboarding response is stored as an unvalidated JSON blob;
- completeness and recommendations are deterministic, tested domain policies and
  do not claim eligibility or tender matching;
- the server derives user identity and verifies organisation membership for every
  read and write;
- important changes create audit events without logging profile values;
- unit, API, conditional validation, autosave/resume, tenant-isolation, and
  completion tests pass;
- formatting, linting, strict type-checking, tests, and production builds pass;
- no document upload, tender ingestion, analysis, RAG, or drafting behavior is
  introduced.

## Phase 3: Secure reusable company document vault

Phase 3 is accepted when:

- binaries upload directly to private object storage under opaque quarantine keys
  and application processes never persist them to local disk;
- requests validate organisation permission, safe filename, MIME/extension, size,
  document count, and duplicate checksum;
- completion checks object metadata and creates an idempotent processing job;
- the worker verifies bytes, SHA-256, content MIME, extension, and malware state;
- scanner failure fails closed and only clean files become `READY`;
- every download repeats tenant authorization, refuses non-ready files, records
  access, and returns a short-lived approved-object URL;
- PostgreSQL retains owner, expiry, verification, immutable versions, access,
  retention, and deletion state;
- the web exposes upload, filtering, status, details, versions, expiry warnings, and
  authorized download controls;
- required malicious upload and tenant-isolation tests and all repository quality
  gates pass;
- no tender-upload behavior is introduced.

## Phase 4: Secure manual tender ingestion

Phase 4 is accepted when:

- all tender records and downloads are organisation-scoped and cross-tenant
  selectors reveal no resource;
- manual, demonstration, and administrator adapters preserve provenance, with the
  required visible non-live label on demonstrations;
- only checksum-, type-, ZIP-policy-, and malware-validated sources become
  `READY` in private approved storage;
- completion and jobs are idempotent, duplicate attachments/corrigenda do not
  create conflicting versions, and prior versions remain immutable;
- bounded progress, failure, cancellation, timeout, and queue concurrency controls
  cannot promote a failed or cancelled source;
- the web supports workspaces, upload, versions, and processing status while every
  future section says “Not implemented in this phase.”;
- OpenAPI, migrations, security tests, all quality gates, and production builds
  pass;
- parsing, AI, matching, eligibility, RAG, drafting, readiness, export, scraping,
  and submission are absent.

## Phase 5: Tender parsing and structured requirement extraction

Phase 5 is accepted when:

- supported ready sources produce a separately tracked immutable extraction run;
- PDF pages, DOCX structure, XLSX/CSV cells, and approved ZIP members are parsed
  with resource bounds and no active content execution;
- every persisted important field and requirement has a validated source citation;
- repeated equivalent starts reuse work while explicit retries create historical
  runs;
- tenant checks protect all reads, reviews, retries, cancellations, events, and
  source access;
- ambiguous, malformed, unsupported, low-text, and scanned inputs are visible
  without invented content, and absent OCR is labelled `OCR_UNAVAILABLE`;
- the web exposes fields, requirements, sources, quality, history, filters,
  progress, and append-only reviews;
- automated domain, parser, migration, API/security, and repository quality gates
  pass;
- company comparison, eligibility decisions, risk analysis, RAG, drafting,
  scraping, and automatic submission remain absent.
