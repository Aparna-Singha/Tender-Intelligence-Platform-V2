# ADR 0014: Product UI and Cross-Platform Development

- Status: Accepted
- Date: 2026-08-03

## Context

The Phase 0–10 backend was exposed through a developer-facing web interface.
Package scripts contained Bash-only syntax, API development did not reliably emit
Nest decorator metadata, and a development `.env` could contaminate a production
Next.js build.

## Decision

Keep the modular monolith and existing APIs. Add a small React design system in
`@tender/ui`, a responsive shell and URL-addressable tender stages. Compose only
existing organisation-scoped responses and deterministic counts.

Use `cross-env` for explicit environments, `rimraf` for cleanup, a small Node
launcher for the Next.js port and Nest CLI for API watch compilation. Retain `tsx
watch` for the non-decorator worker. Add an Ubuntu/Windows CI matrix.

## Consequences

Windows and Linux share commands. Only the active tender stage mounts, reducing
simultaneous fetching. Labels become readable without changing contracts. No API,
domain policy, permission, database schema or migration changes.

Phase 11 readiness and Phase 12 export remain excluded.

## Alternatives

A large UI framework was rejected because the scope is bounded. A dashboard
aggregation endpoint was rejected because existing APIs provide the required data.
`tsx` was rejected for Nest API watch mode because decorator metadata is required.
