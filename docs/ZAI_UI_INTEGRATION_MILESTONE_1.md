# Exact Z.ai UI integration: milestone 1

## Scope and provenance

Branch: `feat/bidveda-exact-ui-integration`.
Base and unchanged HEAD: `5528ab2aca9bd3141cbd03a4de8ac8494da6d520`.
Worktree: `Tender-Intelligence-Platform-V2-ui-integration`.
No commits, pushes, deployments, staging operations or backend changes are part of
this work. The existing untracked `.vscode/` directory is preserved.

Visual source: the supplied `BidVeda_ZAI_UI_Design_Source_Only.tar.gz`, extracted
outside the repository to `../BidVeda-zai-reference`. This is a selective port of
actual source, not a recreation from a description. The reference rendering
harness uses only the relevant screens and dependencies; its original visual
components remain separate from production code.

| Reference source                             | Production source                                 | Adaptation                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/globals.css`                        | `apps/web/src/app/zai.css`                        | Original Tailwind theme, textures, shadows and keyframes; scoped legacy reset, reduced motion, focus and approved label-contrast corrections |
| `src/app/layout.tsx`                         | `apps/web/src/app/layout.tsx`                     | Same Parkinsans weights and JetBrains Mono, self-hosted through Next fonts; corrected mono variable indirection                              |
| `src/components/platform/landing-page.tsx`   | `apps/web/src/components/zai/landing-page.tsx`    | Original section markup; real App Router destinations; labelled illustrative previews; unavailable footer pages are non-interactive          |
| `src/components/platform/auth-screen.tsx`    | `apps/web/src/components/zai/auth-screen.tsx`     | Original two-column presentation; real API client; blank credentials and existing password rules                                             |
| `src/components/platform/app-shell.tsx`      | `apps/web/src/components/zai/shell-view.tsx`      | Original shell, mobile sheet, dropdowns and sliding indicator; route/session data supplied by existing `app-shell.tsx`                       |
| `src/components/platform/dashboard.tsx`      | `apps/web/src/components/zai/dashboard-view.tsx`  | Original grid/cards/Motion; data supplied by existing `dashboard.tsx` loader                                                                 |
| `src/components/platform/motion.tsx`         | `apps/web/src/components/zai/motion.tsx`          | Original easing, stagger, springs and hover definitions; strict return types                                                                 |
| `src/components/ui/*` and `src/lib/utils.ts` | `apps/web/src/components/zai/ui/*` and `utils.ts` | Only the eight used Radix primitives and utility composition; strict TypeScript compatibility                                                |
| FAQ array in `src/lib/mock-data.ts`          | `apps/web/src/components/zai/landing-content.ts`  | Static explanatory copy only; no tender, user or company records                                                                             |

The previous global stylesheet is retained byte-for-byte as `legacy.css` rather
than restyling the remaining workflows in this milestone.

## Functional boundary

The API proxy, `apiRequest`, CSRF transport, shared read deduplication, signed
uploads, authentication contracts, tenant authorization and backend services are
unchanged. The shell retains its bounded stale-response retry, explicit transient
error recovery, 401 redirect and non-retrying 403 denial.

Connected operations:

- `POST /auth/login`, `/auth/register` and `/auth/logout` through the existing
  cookie/CSRF client; no simulated success or local session store.
- `GET /auth/session`, `/organisations`, organisation tender lists and
  `/dashboard-recommendations`; shared shell/dashboard reads remain deduplicated.
- `POST /organisations/:id/select` and `POST /organisations`; the original
  organisation-change event and guarded loaders reconcile the new tenant.
- Actual dashboard filters, deadline helpers, backend workflow states, profile
  recommendations and navigation. Search filters the already loaded current
  organisation tender list without new API requests.

Account-action failures remain visible without pretending that logout or tenant
selection succeeded. Dashboard API errors show recovery controls instead of zero
metrics. Organisation changes clear the old dashboard while replacement data loads.
Tender chat/draft shortcuts remain available in each recent tender's action menu.
The existing contextual assistant is retained; its visual integration is deferred.

Excluded prototype behavior: Zustand authentication/navigation state, populated
credentials, fake notifications, fabricated document counts/readiness, local
approval decisions, simulated uploads/AI, unsupported health claims, a nonfunctional
remember-me control and fake terms/password-reset links. Account registration does
not silently create an organisation; that remains the real separate workflow.

## Dependencies and motion

Only frontend dependencies needed by the source were added: Radix accordion,
avatar, dialog/sheet, dropdown, label, progress and slot; class-variance-authority,
clsx, tailwind-merge; Tailwind 4.1.18/PostCSS and tw-animate-css; Framer Motion 12.43.0.
The prototype's Framer Motion 12.23.2 resolved motion-dom 12.43.0 and failed at runtime
with a missing `activeAnimations` export. Aligning Framer Motion and motion-dom at
12.43.0 resolves that incompatibility. There is one Motion DOM version; original
animation definitions were not simplified. `MotionConfig reducedMotion="user"`
and a CSS reduced-motion query cover JS transforms and CSS animations.

A parsed lockfile comparison against HEAD confirms all existing `packages` and
`snapshots` entries are unchanged; only the web importer changed and new entries
were added. Next.js, React and backend dependency versions are unchanged.

## Visual and browser verification

Screenshots and local harness logs are outside the repository in
`../BidVeda-ui-validation`. Reference and integrated captures cover landing,
login, registration and dashboard at 1440x1000, 768x1024 and 390x844, plus navigation
sheets and organisation menus. Additional captures cover loading, API failure and
reduced motion. These use contract-shaped synthetic browser-intercepted API
responses, never live credentials or staging data.

Manual comparison confirms the original fonts, desktop sidebar width, topbar,
hero proportions, orange/charcoal identity, textures, shadows and card composition.
A legacy blue link/heading margin leak was corrected with scoped style resets.
The prototype and initial port both overflowed on mobile due to implicit grid
minimum widths; explicit single-column/min-width constraints correct the port.

The browser interaction harness verifies tenant selection, refresh, logout,
unauthenticated redirect, API failure/recovery and loading. It observed no page
errors. Card hover moves by -4 px as defined in the source; focused auth input has
a solid 2 px outline; reduced-motion CSS reports a 0.00001 s animation duration.
Mutating mock requests retained the CSRF header. This is frontend verification,
not proof of authenticated backend or deployed proxy operation.

Approved accessibility differences: normal-sized white text on orange was below
AA contrast. Orange backgrounds remain unchanged; affected action labels use
charcoal, orange text on light surfaces uses deep orange, and faint secondary
labels are darkened. Text-only gradients use deeper versions of the same hues;
original background gradients remain. Resting orange labels measure 5.21:1,
hover labels 4.82:1, deep orange on white 5.18:1, secondary text on light grey
5.11:1 and auth input borders on white 3.43:1. Axe 4.10.3 found zero violations
for color-contrast, button-name, link-name, label and aria-valid-attr-value on the
four primary screens. Gradient/translucent regions are reported as incomplete
by the tool and were visually reviewed, not silently counted as automated passes. This is not a comprehensive WCAG certification.

Other intentional differences: genuine metrics/content, removed fake controls,
real dashboard filters and deadline countdowns, recent-row action menus and the
existing assistant launcher. Registration has fewer fields because the API does
not accept a bundled organisation. Content-dependent heights therefore differ;
pixel-perfect equality across populated dashboards is not claimed.

## Validation and remaining limits

Validation uses the isolated worktree, local generated Prisma client and dummy
process environment values. It does not connect to a live database or AI provider.
Exact command results and final counts are recorded in the handoff after the last
verification run. Test cases preserve request-count, navigation, authorization,
recovery and isolation assertions; obsolete visual labels/classes were updated.

The production dependency audit reports 25 high, 13 moderate and 4 low advisories,
zero critical. A separate audit of the unchanged base lockfile reports the same
advisory set and counts. These pre-existing issues need a separate security review;
this UI milestone does not upgrade unrelated backend dependencies.

`pnpm format:check` includes the pre-existing unformatted `.vscode/extensions.json`.
That user artifact is deliberately not changed. Application formatting is checked
separately. Next dev also generates an untracked `apps/web/AGENTS.md`; that generated
file is removed after the local preview servers stop, without changing Next config.

Live authenticated backend verification, staging proxy/cookie deployment and
GitHub CI on this unpushed work are NOT RUN. No staging services were restarted.
The next milestone should port the original `tender-workspace.tsx`, tender list
and `company-docs-page.tsx` visual components onto existing tender/document logic,
followed by `ai-chat-page.tsx`, eligibility, draft and export views in separate scopes.
No mock workflow data from those reference components should be shipped.

## Final local verification

| Check                                                  | Result                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| Frozen lockfile installation; Prisma client generation | PASS; no database migration or live connection                       |
| Repository lint including Markdown                     | PASS after correcting a test type import                             |
| Repository strict typecheck                            | PASS                                                                 |
| Repository tests                                       | PASS: 867 passed, 4 existing infrastructure-dependent skips          |
| Frontend tests (included above)                        | PASS: 172 passed across 27 files                                     |
| Security tests; offline AI evaluation                  | PASS                                                                 |
| Production build                                       | PASS: 10 tasks, dummy process credentials only                       |
| Whole-repository formatting                            | FAIL: pre-existing `.vscode/extensions.json` only, preserved         |
| Changed-file formatting; diff whitespace               | PASS                                                                 |
| Browser checks                                         | PASS against intercepted synthetic API; no live backend verification |
| Dependency audit                                       | FAIL: 42 pre-existing advisories; identical base advisory IDs        |

The build reports a Parkinsans fallback-metrics warning; actual downloaded fonts
rendered in the screenshot checks. No new deployment verification is claimed.
The additional authentication/action suites cover nine cases; dashboard failure
recovery is also covered. Existing request-count assertions remain intact.

The implementation is ready for PR review, not deployment approval. The frontend
milestone is implemented and locally verified, with the formatting artifact,
pre-existing dependency advisories and unperformed live integration checks disclosed.

## Complete changed-file inventory

- `apps/web/package.json`
- `apps/web/postcss.config.mjs`
- `apps/web/src/app/globals.css`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/legacy.css`
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/register/page.tsx`
- `apps/web/src/app/zai.css`
- `apps/web/src/components/app-shell.test.tsx`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/dashboard-request-efficiency.test.tsx`
- `apps/web/src/components/dashboard.behaviour.test.tsx`
- `apps/web/src/components/dashboard.tsx`
- `apps/web/src/components/zai/auth-screen.test.tsx`
- `apps/web/src/components/zai/auth-screen.tsx`
- `apps/web/src/components/zai/dashboard-view.tsx`
- `apps/web/src/components/zai/landing-content.ts`
- `apps/web/src/components/zai/landing-page.tsx`
- `apps/web/src/components/zai/motion.tsx`
- `apps/web/src/components/zai/provider.tsx`
- `apps/web/src/components/zai/shell-actions.test.tsx`
- `apps/web/src/components/zai/shell-view.tsx`
- `apps/web/src/components/zai/ui/accordion.tsx`
- `apps/web/src/components/zai/ui/avatar.tsx`
- `apps/web/src/components/zai/ui/button.tsx`
- `apps/web/src/components/zai/ui/dropdown-menu.tsx`
- `apps/web/src/components/zai/ui/input.tsx`
- `apps/web/src/components/zai/ui/label.tsx`
- `apps/web/src/components/zai/ui/progress.tsx`
- `apps/web/src/components/zai/ui/sheet.tsx`
- `apps/web/src/components/zai/utils.ts`
- `docs/DESIGN_SYSTEM.md`
- `docs/ZAI_UI_INTEGRATION_MILESTONE_1.md`
- `pnpm-lock.yaml`

## Post-commit shell compatibility follow-up

Based on committed milestone `68b7302`, the desktop legacy assistant receives a
shell-scoped height correction: viewport minus the unchanged 4rem topbar and
2rem top/bottom main padding. The existing internal scrolling and mobile layout
remain in place. This replaces the old 76px shell assumption without changing
legacy.css or the original page-transition animation.

Only the navigation sheet and backdrop now use stacking level 70, above the
contextual assistant's 60. Radix retains modal focus trapping, background hiding,
Escape and outside-click dismissal. Explicit close-focus restoration returns to
the external navigation opener. The assistant remains mounted with its state intact.

A component regression test exercises an already-open assistant, forward/reverse
Tab confinement, Escape, close button, backdrop dismissal and opener focus.
These are DOM accessibility checks, not browser geometry measurements. Browser
preview execution remains BLOCKED by the previously reported execution policy;
neither suspected visual failure was reproduced in this follow-up. Desktop bounds,
390px/768px overlap and visual stacking still require a permitted browser preview.

Follow-up verification: all 173 frontend tests across 28 files PASS; frontend
lint, strict typecheck and production build with dummy process values PASS.
Changed-file formatting, Markdown lint and diff whitespace checks PASS.
No live backend, staging or browser deployment verification was performed.
