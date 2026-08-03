# Roadmap

## Phase 10.5 — Cross-platform reliability, product UI and pilot readiness

Status: merged into `main` through PR #11.

- Cross-platform workspace scripts and a Nest-compatible API watch process.
- Explicit development, test and production-build environments.
- Repository-owned accessible UI primitives and responsive application shell.
- Product landing/authentication, dashboard, onboarding, evidence and tender UI.
- URL-addressable tender stages through Phase 10, mounting only the active stage.
- Typed safe browser API errors and behavioural frontend tests.

This phase adds no backend business feature, database table or migration. Phase 11
readiness and Phase 12 export remain future work.

The roadmap sequences outcomes without presenting future work as available. Each
milestone needs its own approved scope and acceptance criteria.

## Milestone 0: Documentation and engineering contract

Status: established as the repository baseline.

- establish product boundaries, non-affiliation language, and user roles;
- document the initial journey, domain model, architecture, security, and RAG rules;
- record foundational ADRs;
- define measurable first-milestone acceptance criteria;
- do not initialize application code.

## Phase 1A: Production monorepo and local infrastructure

Status: implemented on the Phase 1A feature branch.

- pnpm and Turborepo workspace with strict shared TypeScript configuration;
- Next.js web shell, NestJS API on Fastify, and independent worker host;
- PostgreSQL with Prisma migrations, Redis with BullMQ, and local private MinIO;
- validated environment contract, structured logging, request IDs, API envelopes,
  liveness, readiness, and graceful shutdown;
- Dockerfiles, Docker Compose, automated tests, CI, dependency review, and secret
  scanning;
- no authentication or tender business features.

## Phase 4: Secure manual tender ingestion

Status: implemented on the Phase 4 feature branch.

- organisation-private workspaces and immutable source versions;
- manual, labelled curated demonstration, and controlled administrator sources;
- private quarantine, ZIP policy, malware scanning, and approved storage;
- corrigenda, duplicate controls, cancellable idempotent jobs, status events, and
  authorised signed downloads;
- no parsing, risk analysis, matching, RAG, drafting, or export.

## Phase 5: Tender parsing and structured requirement extraction

Status: implemented on the Phase 5 feature branch.

- bounded deterministic PDF, DOCX, XLSX, CSV, and approved ZIP-member parsing;
- immutable extraction runs, source fingerprints, citations, quality issues,
  review history, filtering, and progress updates;
- scanned pages explicitly report `OCR_UNAVAILABLE`;
- no company comparison, eligibility decision, risk analysis, RAG, drafting,
  scraping, automatic submission, or other future-phase behavior.

## Milestone 1: Secure manual-ingestion vertical slice

## Phase 6: Immediate cited tender-risk and ambiguity analysis

Status: implemented on the Phase 6 feature branch.

- deterministic immutable `EARLY` runs over the active extraction;
- validated citations, append-only reviews, invalidation, and human-only pursuit
  decisions;
- evidence comparison is deferred to Phase 7 and missing-document checks to Phase 8;
- final readiness, eligibility, RAG, drafting, export, and submission remain absent.

## Phase 7: Controlled evidence comparison

Status: implemented on the Phase 7 feature branch.

- current Phase 5 extraction, completed EARLY risk run, and human `CONTINUE` gate;
- immutable relational company-evidence snapshots;
- versioned manual company facts and exact human-captured citations;
- conservative deterministic proposals and append-only human decisions;
- invalidation on authoritative input changes and an operational Evidence Matrix;
- Phase 8 checklist, Phase 9 RAG, drafting, readiness, export, scraping, and
  submission remain deferred.

## Phase 8: Missing evidence, document and action checklist

Status: implemented on the Phase 8 feature branch.

- immutable generations against the exact active Phase 7 run and evidence snapshot;
- source-grounded missing-evidence, review, conflict, renewal, and action taxonomy;
- conservative deduplication, versioned priority/date policy, and append-only human
  workflow history;
- Phase 7-backed resolution and invalidation without treating upload as compliance;
- Phase 9 RAG, chatbot, drafting, final readiness, export, scraping, submission, and
  external notifications remain deferred.

In progress; Phase 4 establishes ingestion only.

- Phase 1B complete on its feature branch: account, database session,
  organisation, membership, invitation, and authorisation foundations;
- Phase 2 implemented on its feature branch: progressive onboarding, structured
  company profile, completion guidance, and role-aware dashboard recommendations;
- Phase 3 implemented on its feature branch: private reusable company-document
  versions, quarantine upload, validation, malware scanning, approved private
  storage, signed downloads, expiry, audit, retention, and deletion;
- manual tender PDF, ZIP/annexure, corrigendum, source URL, fixture, and admin import
  paths;
- safe asynchronous parsing and structured requirements;
- immediate cited risk analysis before drafting;
- evidence comparison and controlled eligibility states;
- missing-document checklist;
- tender-scoped cited RAG;
- fact-constrained draft with mandatory human review;
- final readiness audit with the second risk analysis;
- authorized review-package export;
- OpenAPI, observability, tests, CI, backup, and operational foundations.

The measurable exit conditions are in
[Acceptance Criteria](ACCEPTANCE_CRITERIA.md).

## Later candidates

## Phase 10: Fact-constrained tender drafting

Status: implemented on the Phase 10 feature branch.

- immutable snapshots of exact current Phase 5–9 inputs and policy versions;
- controlled templates, claim classes, exact citations, and visible placeholders;
- provider-neutral bounded generation with no fake fallback;
- immutable human revisions, append-oriented review, human-only approval, and
  fail-closed invalidation;
- final readiness, the second risk analysis, export, scraping, and submission
  remain deferred.

## Phase 11: Final readiness audit and second risk analysis

Status: architecture and policy accepted; production implementation pending.

- policy `final-readiness-deterministic-v1` separates transactional hard start
  prerequisites from cited readiness blockers and warnings;
- exactly one current compliant approved `CONSOLIDATED_FIRST_DRAFT` is required;
- an immutable relational Phase 5–10 snapshot and a linked but separate
  `FINAL_READINESS` risk run preserve provenance and authority;
- v1 is deterministic and does not require RAG or an AI provider;
- readiness treatment, human disposition, separation of duties, stale-state
  invalidation, and role-at-draft-approval hardening fail closed;
- Phase 12 export, scraping, portal automation, submission, and autonomous approval
  remain absent.

See [Final Readiness Policy](FINAL_READINESS_POLICY.md) and
[ADR 0015](adr/0015-immutable-final-readiness-and-second-risk-analysis.md).

## Phase 9: Tenant-isolated cited tender chatbot

Status: implemented on the Phase 9 feature branch.

- immutable structure-aware indexes over authorised current sources;
- PostgreSQL FTS and pgvector with hard pre-ranking tenant scope;
- provider-neutral Gemini gateway with no fake fallback;
- fresh retrieval, verified citations, refusal, and human-review states;
- operational tender chatbot with explicit source modes;
- drafting, readiness, export, scraping, and submission remain deferred.

Later work is deliberately uncommitted and requires discovery and ADRs. Candidates
may include stronger collaboration workflows, additional document formats,
additional LLM providers, improved extraction and evaluation, configurable review
policies, and integrations that respect official access terms.

## Not on the current roadmap

- automatic GeM scraping;
- automatic bid submission;
- claims of nationwide live tender coverage;
- guaranteed eligibility or bid success;
- fully autonomous bidding;
- native mobile applications;
- microservices without demonstrated operational need.

Adding any of these requires an explicit product decision, legal and security review,
and revised documentation. The product must never imply government affiliation.
