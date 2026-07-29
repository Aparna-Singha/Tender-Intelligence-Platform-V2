# ADR 0007: Use Database Sessions and Double-Submit CSRF Protection

## Status

Accepted — 2026-07-29

## Context

Phase 1B needs revocable browser authentication, tenant isolation, and no browser
token storage. Authentication state must survive process restarts and revocation
must take effect on the next request.

## Decision

Use random opaque session secrets in an HttpOnly, Secure, SameSite=Strict cookie.
Store only SHA-256 token digests in PostgreSQL. Revalidate expiry, revocation, and
the selected organisation membership on the server. Unsafe requests require an
exact allowed Origin plus a signed double-submit CSRF token. The readable CSRF
cookie is not authentication authority.

Use Node.js scrypt with bounded modern parameters for password hashing. Redis
provides atomic, fail-closed authentication endpoint rate limits. Organisation IDs
from URLs are selectors; guards derive the user from the session and membership
from PostgreSQL. Routes have no access unless explicitly declared public,
authenticated, or organisation-authorised.

## Consequences

- Session revocation is immediate and database-backed.
- No access or refresh token is stored in localStorage.
- Database and Redis availability are required for authenticated requests.
- SameSite=Strict assumes the web and API deployment model remains compatible.
- Production must provide TLS, a strong cookie signing secret, trusted-proxy
  configuration, and real notification delivery.

## Alternatives

JWTs in browser storage were rejected because immediate revocation and safe browser
storage become harder. Cookie sessions without CSRF checks were rejected. In-memory
sessions and throttles were rejected because they are not durable or horizontally
consistent.
