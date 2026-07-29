# Tender Intelligence Platform

Tender Intelligence Platform is an independent AI-assisted tender intelligence and
bid-readiness platform for Indian MSMEs, tender teams, and tender consultants. It is
intended to help teams understand tender requirements, compare them with company
evidence, prepare reviewable drafts, and complete a human-controlled readiness audit.

> **Non-affiliation disclaimer:** Tender Intelligence Platform is an independent
> product. It is not affiliated with, endorsed by, or operated by Government
> e-Marketplace (GeM), the Central Public Procurement Portal (CPPP), or any other
> government authority. It does not guarantee eligibility, compliance, bid
> submission, contract award, or bid success.

## Repository status

This repository currently contains the product documentation and engineering
contract only. Application code has intentionally not been initialized.

## Product principles

- Evidence before assertion: important findings cite document, page, and clause.
- Human control: legal, compliance, eligibility, and submission decisions remain
  with authorized people.
- No invented facts: generated content is constrained by approved company evidence
  and tender sources.
- Privacy by default: customer and tender files are private and organisation-scoped.
- Honest scope: the initial release begins with manual tender ingestion, not broad
  scraping or claims of nationwide coverage.

## Documentation

- [Product scope](docs/PRODUCT_SCOPE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Domain model](docs/DOMAIN_MODEL.md)
- [Security model](docs/SECURITY_MODEL.md)
- [RAG policy](docs/RAG_POLICY.md)
- [Roadmap](docs/ROADMAP.md)
- [Acceptance criteria](docs/ACCEPTANCE_CRITERIA.md)
- [Architecture decision records](docs/adr/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Planned technical direction

The approved direction is a strict TypeScript monorepo with a Next.js web
application, a modular TypeScript API built on a production framework with Fastify
support, background workers and queues, PostgreSQL, private S3-compatible object
storage, Redis, PostgreSQL full-text search, pgvector, OpenAPI, observability, tests,
and CI. Gemini is the first planned LLM provider behind a provider-neutral gateway.

No application dependencies, runtime services, or environment variables are defined
in this documentation phase.

## Contributing

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before making
changes. Security concerns should follow [SECURITY.md](SECURITY.md), not public issue
discussion.

## License

No license has been selected. Until one is added, all rights are reserved.
