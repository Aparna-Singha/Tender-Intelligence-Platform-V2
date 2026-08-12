# Phase 14 Reliability and Error Correctness

Date: Wednesday, August 12, 2026

Status: implemented locally; production readiness remains limited by remaining
transitive dependency audit findings and any real-stack validation not completed in
the current environment.

## Problem Statement

Registration previously converted every database failure during user creation into
HTTP 409 Conflict. A PostgreSQL credential mismatch, including Prisma `P1000`,
could therefore appear to the browser as a duplicate-account conflict. Login also
needed a clearer distinction between invalid credentials and dependency failures.

## Error Policy

- Duplicate registered email: `409 CONFLICT`, safe public envelope.
- Wrong login credentials: `401 UNAUTHORIZED`.
- PostgreSQL authentication, connectivity, timeout, or unavailable dependency:
  `503 SERVICE_UNAVAILABLE`.
- Validation errors: existing bounded bad-request behavior.
- Unexpected bugs: existing bounded internal-error response with request ID.

Public errors must not expose Prisma classes, Prisma codes, SQL, connection
strings, credentials, stack traces, Redis internals, MinIO credentials, or
environment values.

## Authentication Consistency

Registration now creates the user, session, and `LOGIN_SUCCEEDED` audit event in a
single transaction. If session or audit creation fails, the registration is not
partially committed.

Successful login also creates the session and `LOGIN_SUCCEEDED` audit event in a
single transaction. Invalid credentials still create a `LOGIN_FAILED` audit event;
if that audit write fails because the database is unavailable, the request returns
a dependency failure rather than pretending credentials were invalid.

## Developer Doctor

`pnpm run doctor` is a read-only local diagnostic. Bare `pnpm doctor` is pnpm's
own built-in diagnostic command, so the repository-owned check is exposed through
the explicit script runner. It checks:

- Node version;
- `.env` presence, required values, unresolved secret placeholders, and
  PostgreSQL `DATABASE_URL` alignment with `POSTGRES_*` values using URL decoding;
- pnpm availability;
- Docker Compose availability;
- PostgreSQL login/query, including credential rejection;
- Redis `PING`;
- MinIO live health endpoint;
- ClamAV `PING`;
- Prisma migration status without applying migrations.

The command redacts secrets and never deletes Docker volumes, rewrites `.env`,
changes migration history, applies migrations, runs `prisma db push`, or resets
data.

If PostgreSQL rejects configured credentials, the diagnostic explains that changing
`.env` does not change credentials already initialized inside an existing local
Docker volume. Any `docker compose down -v` recovery must be an explicit,
destructive local-development choice because it deletes local database/storage
data. It is not production guidance.

Recommended local flow:

```text
copy .env.example -> .env
configure safe local values
pnpm install --frozen-lockfile
pnpm db:generate
pnpm dev:infra
pnpm run doctor
pnpm db:migrate:deploy
pnpm run doctor
pnpm dev
```

## Dependency Audit

Before remediation, `pnpm audit --prod` reported 6 vulnerabilities:

- `fast-uri`, high, through Fastify/Nest transitive paths;
- `brace-expansion`, high, through `@fastify/static`/Swagger transitive paths;
- `pdfjs-dist`, high, direct worker dependency;
- `nanoid`, high, through Next/PostCSS;
- `postcss`, moderate, through Next.

Safe Phase 14 remediation:

- updated direct worker `pdfjs-dist` from `6.1.200` to `6.2.108`;
- updated Next from `16.2.12` to `16.3.0`.

After remediation, `pnpm audit --prod` reports 3 remaining vulnerabilities:

- `brace-expansion`, high, through `@fastify/static`/Swagger;
- `nanoid`, high, through `next > postcss`;
- `postcss`, moderate, through `next`.

Fastify `5.11.3` and `@fastify/static` `10.1.3` were inspected but not kept
because they conflicted with current Nest/Fastify or Nest/Swagger type and peer
contracts and did not safely clear all relevant findings. No override or
suppression was added.

## Rollback

Phase 14 has no database schema migration. Reverting the code and dependency
changes does not require authoritative data recovery. Existing historical audit,
tender, source, evidence, readiness, and package records are unchanged.

## Phase 15 Boundary

This phase preserves the existing request-ID envelope and targeted diagnostic
logging. Distributed tracing, SLO dashboards, complete queue tracing, failover
architecture, and broad production observability remain Phase 15 work.
