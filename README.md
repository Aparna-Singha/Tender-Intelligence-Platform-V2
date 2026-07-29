# Tender Intelligence Platform

Phase 7 adds controlled requirement-to-company-evidence comparison. After a
completed cited EARLY risk analysis and an authorised human `CONTINUE`, the API
captures an immutable company-evidence snapshot and queues deterministic
requirement assessments. The tender workspace exposes an Evidence Matrix with
source citations, conservative proposals, uncertainty, conflicts, review state,
history, and invalidation. See [the evidence policy](docs/EVIDENCE_POLICY.md) and
[comparison policy](docs/COMPARISON_POLICY.md).

This is not a global eligibility decision or a guarantee of bid success.
Company-document OCR/extraction, missing-document checklists, RAG/chatbot,
drafting, readiness audit, export, scraping, and submission are not implemented
in this phase.

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

Phase 1B adds the PostgreSQL identity schema, database-backed browser sessions,
authentication, organisations, invitations, deny-by-default authorisation, and a
minimal protected web shell. Tender and onboarding business features remain
intentionally unimplemented.

Phase 2 adds an eight-step progressive onboarding wizard and structured,
organisation-scoped company profiles. It does not upload or verify documents and
does not perform tender matching.

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

## Workspace

```text
apps/
  web/       Next.js App Router application
  api/       NestJS API on Fastify
  worker/    Independent BullMQ worker host and health server
packages/
  config/          Environment validation
  contracts/       Runtime and TypeScript API contracts
  database/        Prisma and PostgreSQL adapter
  domain/          Framework-independent domain primitives
  observability/   Structured logging
  ui/              Shared UI primitives
  testing/         Shared test utilities
infrastructure/
  docker/     Production Dockerfiles
  scripts/    Local infrastructure and health scripts
```

PostgreSQL is authoritative. Redis is used for ephemeral coordination and BullMQ,
and MinIO provides private S3-compatible object storage locally. No service treats
process memory as persistent storage.

## Prerequisites

- Node.js 22.18 or newer;
- Corepack;
- Docker Engine with Docker Compose v2;
- Git.

The repository pins pnpm through the `packageManager` field.

## Local setup

1. Clone and enter the repository:

   ```sh
   git clone https://github.com/Aparna-Singha/Tender-Intelligence-Platform-V2.git
   cd Tender-Intelligence-Platform-V2
   ```

2. Enable the pinned package manager:

   ```sh
   corepack enable
   pnpm --version
   ```

3. Create local configuration:

   ```sh
   cp .env.example .env
   ```

   Replace every `replace-with-local-*` value in `.env`. Keep the PostgreSQL values
   in `DATABASE_URL` aligned with `POSTGRES_USER` and `POSTGRES_PASSWORD`, and keep
   the S3 access keys aligned with the MinIO root credentials. These values are for
   local development only.

4. Install dependencies:

   ```sh
   pnpm install --frozen-lockfile
   ```

5. Start PostgreSQL, Redis, MinIO, and the local ClamAV scanner:

   ```sh
   pnpm dev:infra
   ```

   To wait for all infrastructure health checks and initialize the private MinIO
   bucket, use:

   ```sh
   ./infrastructure/scripts/start-local.sh
   ```

6. Apply database migrations:

   ```sh
   pnpm db:migrate:deploy
   ```

7. Start the web, API, and worker processes:

   ```sh
   pnpm dev
   ```

The services are then available at:

| Service          | URL                             |
| ---------------- | ------------------------------- |
| Web              | `http://localhost:3000`         |
| API liveness     | `http://localhost:4000/health`  |
| API readiness    | `http://localhost:4000/ready`   |
| OpenAPI UI       | `http://localhost:4000/openapi` |
| Worker liveness  | `http://localhost:4001/health`  |
| Worker readiness | `http://localhost:4001/ready`   |
| MinIO API        | `http://localhost:9000`         |
| MinIO console    | `http://localhost:9001`         |

Run all health checks with:

```sh
./infrastructure/scripts/check-health.sh
```

Stop local infrastructure without deleting its named volumes:

```sh
pnpm dev:infra:down
```

## Environment configuration

All applications fail fast on invalid environment values through
`@tender/config`. `.env.example` documents the current local contract.
Real credentials and production configuration must come from an approved secret
manager and must not be committed.

Next.js only receives `NEXT_PUBLIC_API_URL`. Server credentials must never use a
`NEXT_PUBLIC_` prefix.

For local HTTP only, set `SESSION_COOKIE_SECURE=false`; production must use
`SESSION_COOKIE_SECURE=true` behind TLS. Set `WEB_ORIGIN` to the exact browser
origin. Registration and login work without notification delivery, but invitations
and usable password-reset email require all three `EMAIL_DELIVERY_*` values. The
delivery endpoint receives a bearer-authenticated JSON template request; no email
delivery is simulated.

The document worker requires `CLAMAV_HOST` and `CLAMAV_PORT`. Upload and download
URL lifetimes are bounded by `DOCUMENT_UPLOAD_TTL_SECONDS` (60–900) and
`DOCUMENT_DOWNLOAD_TTL_SECONDS` (30–300). Company document binaries transfer
directly between the browser and private MinIO storage and are never persisted to
the API or worker filesystem.

Phase 4 tender-source binaries follow the same private direct-upload pipeline.

Phase 5 adds deterministic tender extraction after source processing. A tender
workspace can start a run and inspect status, quality issues, cited source fields,
and structured requirements. Extraction is evidence capture only: it does not
decide eligibility, compare company evidence, assess risk, or draft a bid. PDF,
DOCX, XLSX, CSV, and approved ZIP members are supported with bounded worker
processing. Scanned pages are labelled `OCR_UNAVAILABLE` because no OCR engine is
configured in this phase.
Accepted source formats are PDF, ZIP, XLSX, DOCX, and CSV up to 25 MiB. ZIP
inspection rejects traversal, nested archives, excessive members, expanded-size
limits, and suspicious compression ratios before malware scanning.

## Authentication API

The OpenAPI 3 contract is generated from controllers and is available at
`/openapi` (interactive UI) and `/openapi-json` (machine-readable JSON).
Phase 1B exposes CSRF issuance, registration, login, logout, password reset,
session listing/revocation, organisation creation/listing/selection, membership,
invitation, and role-change operations. Browser mutation requests first fetch
`GET /auth/csrf`, retain `data.csrf_token` in memory, and send it as
`x-csrf-token`; credentials are always cookie-based.

Phase 2 adds:

- `GET /organisations/{organisationId}/onboarding`
- `PUT /organisations/{organisationId}/onboarding/steps/{step}`
- `GET /organisations/{organisationId}/company-profile`
- `GET /organisations/{organisationId}/dashboard-recommendations`

All endpoints derive the user from the database session and enforce
organisation-scoped permissions. The OpenAPI UI and `/openapi-json` include these
operations.

Phase 4 adds organisation-scoped `/organisations/{organisationId}/tenders`
operations for workspace creation, controlled imports, metadata, versioned source
uploads, corrigenda, private downloads, job status/cancellation, and server-sent
job events. Parsing, analysis, eligibility, RAG, and drafting remain unavailable.

## API envelopes

Successful API responses use:

```json
{
  "data": {},
  "request_id": "..."
}
```

Errors use safe public messages:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Safe public message"
  },
  "request_id": "..."
}
```

Incoming request IDs are accepted only when they match the bounded safe character
set; otherwise the service generates a UUID.

## Quality gates

After a clean checkout and dependency installation, generate the Prisma Client
before running any type-aware validation:

```sh
pnpm install --frozen-lockfile
pnpm db:generate
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Container builds

Run these commands from the repository root:

```sh
docker build -f infrastructure/docker/web.Dockerfile -t tender-web .
docker build -f infrastructure/docker/api.Dockerfile -t tender-api .
docker build -f infrastructure/docker/worker.Dockerfile -t tender-worker .
```

Runtime containers require the environment values documented in `.env.example`.
The Dockerfiles do not copy `.env` files into images.

## Contributing

Read [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) before making
changes. Security concerns should follow [SECURITY.md](SECURITY.md), not public issue
discussion.

## License

No license has been selected. Until one is added, all rights are reserved.

## Phase 6 early cited risk analysis

Phase 6 adds a deterministic `EARLY` risk gate over the active completed extraction,
with exact citations, append-only human reviews, and human-only CONTINUE/HOLD/STOP
decisions. It does not determine eligibility, compare company evidence, provide
legal advice, guarantee detection, or implement final-readiness analysis. See the
[risk policy](docs/RISK_POLICY.md).

## Phase 8 missing evidence and action checklist

Phase 8 adds the source-grounded checklist described in the
[Checklist Policy](docs/CHECKLIST_POLICY.md). It requires the exact current Phase 7
assessment and immutable evidence snapshot. Checklist workflow progress is not an
eligibility or bid-readiness score, and uploading a file does not prove compliance
or resolve an item.
