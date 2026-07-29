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
