# Isolated UI visual preview

The feature branch has a read-only visual preview at
`/visual-preview/dashboard` and `/visual-preview/evidence`. Both pages use
synthetic in-memory examples and the existing Z.ai shell, dashboard and evidence
components. The banner identifies the examples. They do not demonstrate
authentication, document upload, evidence review, eligibility or a working API.

The pages exist only when both `VERCEL_ENV=preview` and
`BIDVEDA_VISUAL_PREVIEW=true` are set. In that mode the same-origin `/api`
handler returns a no-store 503 response before accessing the upstream proxy,
including for writes. The normal production proxy remains unchanged when the
preview flag is absent. The visual preview must not be configured as a
production environment. Turborepo includes the flag in its strict build
environment and cache key.

Before pushing this branch, verify in Vercel that the connected project builds
`apps/web`, its production branch is `main`, and this branch will receive a
Preview deployment. Set **branch-scoped Preview** variables for this branch:

| Variable                     | Preview value                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `BIDVEDA_VISUAL_PREVIEW`     | `true`                                                                           |
| `NEXT_PUBLIC_API_URL`        | `/api`                                                                           |
| `API_PROXY_ORIGIN`           | An unused HTTPS `.invalid` origin, for example `https://api-preview.invalid`     |
| `CF_ACCESS_CLIENT_ID`        | A non-secret dummy string of at least 16 characters                              |
| `CF_ACCESS_CLIENT_SECRET`    | A different non-secret dummy string of at least 16 characters                    |
| `NEXT_PUBLIC_STORAGE_ORIGIN` | An unused HTTPS `.invalid` origin, for example `https://storage-preview.invalid` |

The last five values satisfy the existing strict web environment schema. No
real Cloudflare Access credential, R2 origin, staging API origin or private
document belongs in this visual preview environment. Check the branch-scoped
values **before** pushing: a Git-connected Vercel project may automatically
deploy every non-production branch push. Do not reuse an unverified API on
port 4202 or the existing staging backend.

After deployment, confirm the banner and synthetic labels on both routes,
navigation between the two views, mobile sidebar behavior, assets, browser
console, and desktop/tablet/mobile layouts. Confirm `/api/health` returns
`503` with `VISUAL_PREVIEW_ONLY` and no upstream request. Real application
routes will show their normal API-unavailable states. Treat all account,
upload, reviewer and eligibility actions as **untested** until the separate
authenticated Milestone 2A.4D workflow succeeds against an isolated backend.

No Vercel or GitHub deployment has been performed by this preparation.
