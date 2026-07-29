# Roadmap

The roadmap sequences outcomes without presenting future work as available. Each
milestone needs its own approved scope and acceptance criteria.

## Milestone 0: Documentation and engineering contract

Status: current phase.

- establish product boundaries, non-affiliation language, and user roles;
- document the initial journey, domain model, architecture, security, and RAG rules;
- record foundational ADRs;
- define measurable first-milestone acceptance criteria;
- do not initialize application code.

## Milestone 1: Secure manual-ingestion vertical slice

Planned, not implemented.

- account, organisation, membership, and progressive onboarding foundations;
- private reusable company-document upload;
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
