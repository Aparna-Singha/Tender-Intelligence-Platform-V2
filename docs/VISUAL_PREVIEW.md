# Isolated UI visual preview

The feature branch has a read-only visual preview at
`/visual-preview/dashboard` and `/visual-preview/evidence`. Both pages use
synthetic in-memory examples and the existing Z.ai shell, dashboard and evidence
components. The banner identifies the examples. They do not demonstrate
authentication, document upload, evidence review, eligibility or a working API.
The evidence view separates an attached but unverified document from a recorded
assessment decision. A second synthetic item illustrates why a historical
verified decision can require reassessment. The dashboard's live-only actions
are disabled; its synthetic filters and the two preview navigation routes work.

The pages exist only when both `VERCEL_ENV=preview` and
`BIDVEDA_VISUAL_PREVIEW=true` are set. In that mode the same-origin `/api`
handler returns a no-store 503 response before accessing the upstream proxy,
including for writes. The normal production proxy remains unchanged when the
preview flag is absent. In visual preview, the route proxy blocks real application
pages, the build rejects a non-`/api` browser API URL, and the CSP permits only
same-origin connections. Unavailable shell links stay on the synthetic page.
The visual preview must not be configured as a
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
routes return 404 in visual-preview mode. Treat all account,
upload, reviewer and eligibility actions as **untested** until the separate
authenticated Milestone 2A.4D workflow succeeds against an isolated backend.

No Vercel or GitHub deployment has been performed by this preparation.

## Backend dependency for real evidence actions

The visual preview is independent of the API. For the authenticated Eligibility
screen, this frontend expects the following requirement-scoped routes beneath
`/organisations/:organisationId/tenders/:tenderId/versions/:versionId/requirements/:requirementId`:

| Method   | Suffix                                       | Expected result                                                                |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET`    | `/attachments`                               | Active attachment array with document, exact version and upload-session status |
| `GET`    | `/evidence-candidates?search=&limit=50`      | `{ items: [...] }` of authorised reusable documents and current versions       |
| `POST`   | `/upload-sessions`                           | `{ attachment_id, upload_session_id, upload_url }` for a private signed upload |
| `POST`   | `/upload-sessions/:uploadSessionId/complete` | Completion through the existing private upload lifecycle                       |
| `POST`   | `/attachments`                               | Persist a selected `document_id`, `document_version_id` and `idempotency_key`  |
| `DELETE` | `/attachments/:attachmentId`                 | Detach evidence while preserving the source document                           |

At `main` commit `6b28c94`, no controller registers these routes. The existing
eligibility controller does provide assessment runs, the matrix, item reviews,
company facts and assessment evidence links at different paths. The six routes
above require the separately reviewed Milestone 2A backend before the real
evidence upload and selection flows can work. Frontend unit tests use mocked
responses and do not establish backend compatibility. Do not present the real
Eligibility attachment UI as operational on a deployment of this `main` API.
