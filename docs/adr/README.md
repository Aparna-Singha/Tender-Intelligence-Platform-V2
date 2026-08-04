# Architecture Decision Records

Architecture Decision Records (ADRs) capture consequential technical and product
decisions, their context, alternatives, and trade-offs.

## Index

| ADR                                                                | Decision                                           | Status   |
| ------------------------------------------------------------------ | -------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)                                   | Use a modular monolith initially                   | Accepted |
| [0002](0002-postgresql-source-of-truth.md)                         | Use PostgreSQL as the source of truth              | Accepted |
| [0003](0003-manual-tender-ingestion-first.md)                      | Start with manual tender ingestion                 | Accepted |
| [0004](0004-human-in-the-loop-ai.md)                               | Keep high-stakes AI workflows human-controlled     | Accepted |
| [0005](0005-private-object-storage.md)                             | Store document binaries in private object storage  | Accepted |
| [0006](0006-prisma-postgresql-orm.md)                              | Use Prisma with the PostgreSQL driver adapter      | Accepted |
| [0007](0007-database-sessions-and-csrf.md)                         | Use database sessions and double-submit CSRF       | Accepted |
| [0008](0008-deterministic-immutable-tender-extraction.md)          | Deterministic immutable tender extraction          | Accepted |
| [0009](0009-deterministic-early-risk-gate.md)                      | Deterministic cited early-risk gate                | Accepted |
| [0010](0010-immutable-controlled-evidence-assessments.md)          | Immutable controlled evidence assessments          | Accepted |
| [0011](0011-immutable-source-grounded-checklists.md)               | Immutable source-grounded action checklists        | Accepted |
| [0012](0012-tenant-isolated-hybrid-rag.md)                         | Tenant-isolated hybrid cited RAG                   | Accepted |
| [0013](0013-fact-constrained-immutable-drafting.md)                | Fact-constrained immutable drafting                | Accepted |
| [0014](0014-product-ui-and-cross-platform-development.md)          | Product UI and cross-platform development          | Accepted |
| [0015](0015-immutable-final-readiness-and-second-risk-analysis.md) | Immutable final readiness and second risk analysis | Accepted |
| [0016](0016-immutable-controlled-review-package-export.md)         | Immutable controlled review-package export         | Proposed |

## Process

Create an ADR when a decision affects multiple modules, security or privacy posture,
operational ownership, a public contract, or is expensive to reverse.

Use the next four-digit sequence number. Include title, status, date, context,
decision, consequences, alternatives, and follow-up constraints. Accepted ADRs are
immutable historical records: supersede one with a new ADR and link both rather than
rewriting the old decision.

Proposed ADRs require relevant engineering, product, and security review. Dates use
ISO 8601.
