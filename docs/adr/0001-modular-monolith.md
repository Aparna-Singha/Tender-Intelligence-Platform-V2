# ADR 0001: Use a Modular Monolith

- Status: Accepted
- Date: 2026-07-29

## Context

The initial product spans identity, organisations, document evidence, tender
processing, analysis, retrieval, drafting, review, readiness, export, and
administration. The domain needs clear boundaries, but the early team and workload do
not justify independent service deployment, distributed transactions, or duplicated
operational infrastructure.

## Decision

Build the initial backend as a modular TypeScript monolith in a TypeScript monorepo.
Use a production TypeScript framework with Fastify support for the API and separate
queue worker processes from the same versioned codebase where operationally useful.

Each domain module owns its policies and persistence access. Modules communicate
through explicit application interfaces and domain events, not imports into internal
implementation details. Transport, persistence, object storage, queues, and LLMs are
adapters around domain and application logic.

The Next.js web application is a separate deployable within the monorepo. Process
separation does not make a module a microservice.

## Consequences

- Transactions, local development, testing, and deployment remain comparatively
  simple.
- Module boundaries require architectural tests and review because a single process
  does not enforce them.
- Components can scale as API or worker processes without prematurely distributing
  domain ownership.
- A future extraction requires evidence of independent scaling, availability,
  security, or ownership needs and a new ADR.

## Alternatives considered

- **Microservices from the start:** rejected because operational and consistency
  costs exceed demonstrated benefits.
- **Unstructured monolith:** rejected because tight coupling would make security,
  testing, and later change unsafe.
- **Serverless functions as the primary boundary:** not selected because document
  workflows and module ownership need consistent contracts; specific functions may
  still be evaluated later.
