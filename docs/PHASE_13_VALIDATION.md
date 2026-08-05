# Phase 13 Validation

Date: Wednesday, August 5, 2026

Status: controlled review-package real-stack and real-browser validation passed for
the implemented Phase 12/13 scope. Production readiness is still `NOT READY`
because dependency audit findings and a few validation-environment limitations
remain.

## Scope

Phase 13 validated the implemented controlled review-package lifecycle against the
real local stack:

- PostgreSQL
- Redis
- MinIO
- ClamAV
- built API server
- built worker
- built web application
- Chromium via Playwright

The validation did not add a new product feature and did not add external tender
submission behavior.

## Tooling added

- pinned `@playwright/test` development dependency at `1.51.1`
- root scripts:
  `playwright:install` and `test:browser`
- root `playwright.config.ts`
- `e2e/phase13-controlled-review-package.spec.ts`
- ignored Playwright output directories in `.gitignore`

## Real-stack results

- `pnpm db:migrate:deploy`: passed, no pending migrations
- `pnpm db:generate`: passed
- Docker health confirmed for `postgres`, `redis`, `minio`, and `clamav`
- `pnpm format:check`: passed
- `pnpm lint`: passed
- `pnpm typecheck`: passed
- `pnpm test`: passed
- `pnpm build`: passed
- `git diff --check`: passed

## Browser validation results

`pnpm test:browser -- e2e/phase13-controlled-review-package.spec.ts` passed on the
real stack.

Validated behaviors:

- authenticated login and navigation
- mobile-width render without horizontal overflow
- controlled review-package generation
- requester self-approval blocked
- reviewer append-only review
- independent approval for controlled download
- one-minute download authorization and actual ZIP download
- second equivalent generation with byte-identical ZIP and PDF hashes
- current-package supersession
- approval revocation
- consultant visibility
- platform-admin denial without tenant context
- cross-tenant denial without tenant context

## Defects found and fixed

### Stable package identity leak

Equivalent packages were not deterministic because run-specific IDs leaked into:

- manifest `package_id`
- provenance `package_id`
- rendered PDF package identifier

Fix:

- added deterministic `deriveControlledPackageStableId(...)`
- replaced run-ID-based package identifiers with fingerprint-derived stable IDs

### Nondeterministic render timestamp

Equivalent package runs produced different `canonicalRenderTimestamp` values from
`new Date()` at start time. That changed:

- PDF content
- manifest `generated_at`
- logical content fingerprint
- final ZIP hash

Fix:

- derive the package snapshot `canonicalRenderTimestamp` from the pinned Phase 11
  snapshot `capturedAt` instead of package start wall-clock time

## Artifact inspection results

The Playwright artifact inspection verified:

- the downloaded ZIP contains exactly four regular files:
  `review.pdf`, `manifest.json`, `SHA256SUMS.txt`, and
  `provenance-index.json`
- member names are safe and flat
- checksums cover `review.pdf` and `provenance-index.json`
- provenance omits signed URLs, credentials, and object-key leaks
- the PDF contains the expected passive/disclaimer content checks and no active
  content markers such as JavaScript, launch actions, or embedded files
- equivalent runs now produce identical PDF and ZIP SHA-256 hashes

## Accessibility and responsive notes

Responsive validation covered desktop and mobile widths for the controlled package
workspace, including a mobile overflow assertion.

Accessibility coverage improved through the exercised browser flow and existing web
tests, including:

- labeled auth fields
- visible role-based state text
- `aria-live` status messaging in the controlled package workspace

Limit:

- no repository-native dedicated accessibility engine or Axe-based browser audit was
  present, and none was added in Phase 13

## Dependency audit

`pnpm audit` reported 6 advisories on Wednesday, August 5, 2026:

- 5 high
- 1 moderate

Notable findings included:

- `playwright < 1.55.1`
- `fast-uri`
- `brace-expansion`
- `postcss`

These findings block a production-readiness claim until triaged and remediated.

## Remaining limitations

- `pnpm audit` is not clean
- no dedicated repository-native OpenAPI validation script was found or executed
- the current Playwright built-web startup emits a Next.js warning that `next start`
  is not aligned with `output: standalone`; runtime behavior still passed in local
  validation
- the new Playwright suite covers the critical lifecycle and forbidden-access paths,
  but it does not yet encode every negative/race scenario listed in the broader
  Phase 13 prompt

## Release-readiness decision

Decision: `NOT READY FOR PRODUCTION CLAIM`

Reason:

- implemented Phase 12/13 workflow behavior passed real-stack validation
- dependency audit and remaining validation gaps still need follow-up before a
  production-ready claim is accurate
