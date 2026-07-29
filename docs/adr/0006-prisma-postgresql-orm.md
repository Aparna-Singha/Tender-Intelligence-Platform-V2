# ADR 0006: Use Prisma with the PostgreSQL Driver Adapter

- Status: Accepted
- Date: 2026-07-29

## Context

The platform needs a mature TypeScript ORM with schema generation, typed database
access, versioned migrations, and a production deployment workflow. PostgreSQL
remains authoritative, and the ORM must not obscure explicit SQL needed for
PostgreSQL extensions such as pgvector.

## Decision

Use Prisma ORM with PostgreSQL. Prisma schema and migrations live in
`packages/database`. Runtime clients use Prisma's maintained `@prisma/adapter-pg`
driver adapter and the `pg` connection pool.

Application code receives Prisma through the database package rather than creating
clients inside domain modules. The connection pool uses a finite connection timeout
and bounded maximum size. Long-running processes create one client and close it
during graceful shutdown.

Use `prisma migrate dev` only for authoring local migrations and `prisma migrate
deploy` for applying committed migrations in shared or production environments.
Handwritten SQL migrations are allowed when Prisma schema syntax cannot represent a
PostgreSQL capability, and must remain reviewable and reversible or have documented
forward recovery.

## Consequences

- TypeScript receives generated, schema-aligned database types.
- The team must generate the client after schema changes and review migration SQL.
- Prisma and its driver adapter must be upgraded and tested together.
- Pool sizing remains an operational setting to revisit with measured concurrency.
- pgvector operations may require typed repository adapters around explicit SQL.

## Alternatives considered

- **Drizzle ORM:** viable and SQL-oriented, but Prisma was selected for its migration
  workflow, generated client, documentation, and broad operational familiarity.
- **TypeORM:** not selected because Prisma provides a more constrained generated
  client and clearer migration workflow for this foundation.
- **Raw SQL only:** rejected for the initial platform because it would increase
  repetitive mapping work, while explicit SQL remains available where needed.
