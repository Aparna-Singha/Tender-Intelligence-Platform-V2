# ADR 0002: Use PostgreSQL as the Source of Truth

- Status: Accepted
- Date: 2026-07-29

## Context

Tender processing produces related workflow state, evidence versions, citations,
eligibility assessments, reviews, approvals, audits, and exports. These records
require transactions, constraints, traceability, and organisation isolation.
Retrieval also needs lexical and vector search without creating a second
authoritative datastore in the first milestone.

## Decision

Use PostgreSQL as the authoritative store for business state. Use PostgreSQL
full-text search and pgvector initially for derived retrieval indexes.

Private S3-compatible storage holds binary objects referenced by database metadata.
Redis supports ephemeral caching, coordination, rate limiting, and queues but never
authoritative workflow state. Search indexes, caches, embeddings, and projections
must be rebuildable from PostgreSQL and accepted source objects.

Schema design must enforce referential integrity and organisation boundaries.
Migrations are version-controlled, reviewed, tested, and accompanied by rollback or
forward-recovery guidance.

## Consequences

- Business transactions and audit relationships have one consistency boundary.
- PostgreSQL operations, backup, restoration, capacity, pgvector, and full-text
  performance become production responsibilities.
- Large binaries stay outside the database while their ownership and lifecycle
  remain authoritative in it.
- A dedicated search or vector service may be introduced only when measured limits
  justify the consistency and operational cost.

## Alternatives considered

- **Independent vector database initially:** rejected because it adds tenant-isolation
  and synchronization risk before scale requires it.
- **Redis as workflow storage:** rejected because the required state is durable and
  relational.
- **Object metadata as the source of truth:** rejected because it cannot safely own
  transactional workflow and review relationships.
