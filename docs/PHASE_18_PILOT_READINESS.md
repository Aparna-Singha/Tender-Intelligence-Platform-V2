# Phase 18 Pilot Readiness

Status: DESIGN INPUT REQUIRED for product redesign integration.

Phase 18 starts from `origin/main` after Phase 17. The attached Phase 18 brief
contained a placeholder design source rather than an accessible Figma URL, export,
or local design specification:

```text
[PASTE FIGMA URL / FIGMA EXPORT PATH / LOCAL DESIGN SPEC PATH HERE]
```

Design-dependent implementation remains blocked until the approved design source is
provided. The repository-owned product model, security model, and existing web UI
remain the authoritative source for non-design validation.

## Intended Pilot Audience

The engineering pilot is intended for Indian MSME tender teams, tender consultants,
and internal operators validating the first tender workflow with synthetic or
approved non-sensitive documents. The product is independent and is not affiliated
with GeM, CPPP, or any government authority.

## Supported Pilot Workflow

The repository supports an authenticated workflow covering registration,
organisation setup, onboarding, company evidence, tender workspaces, document
upload, malware scanning, extraction/OCR, checklist, risk analysis, RAG, controlled
drafting, final readiness, and controlled review-package lifecycle where the
required infrastructure and provider configuration are available.

Pilot users should be guided through:

1. register with a synthetic pilot account;
2. create or join an organisation;
3. complete organisation onboarding;
4. upload company evidence;
5. create a tender workspace;
6. upload a synthetic tender document;
7. wait for scan and extraction completion;
8. inspect source citations and OCR provenance;
9. review evidence, checklist, risk, RAG, draft, readiness, and package state;
10. record feedback with request IDs and workflow step names.

## Environment Prerequisites

- PostgreSQL, Redis, MinIO, ClamAV, API, worker, and web are running.
- Database migrations are applied and Prisma client generation has completed.
- `.env` uses non-placeholder local or test values.
- Provider-backed RAG and drafting require approved provider configuration.
- Browser validation uses the repository Chromium Playwright configuration.
- Uploaded files must be synthetic or explicitly approved for pilot use.

## Synthetic Smoke Procedure

Run the normal deterministic checks before a pilot smoke:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:security
pnpm eval:offline
pnpm build
pnpm test:browser
pnpm run doctor
```

Then run one real-stack synthetic workflow through the browser and API using local
pilot credentials. Confirm API and worker readiness, private storage behavior,
scanner function, queue progress, bounded API errors, source/citation inspection,
and controlled package authorization boundaries.

## Design Mapping

| Design screen or component      | Existing route or component                                       | Implementation status | Backend/API dependency                                                 | Trust/security constraint                      |
| ------------------------------- | ----------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------- |
| Approved global navigation      | `AppShell`                                                        | DESIGN INPUT REQUIRED | session and memberships                                                | Tenant context is server-derived               |
| Approved first-use flow         | `Dashboard`, `OnboardingWizard`, `DocumentCentre`, `TenderCentre` | DESIGN INPUT REQUIRED | auth, organisations, onboarding, documents, tenders                    | No fake completion or hidden bypass            |
| Approved dashboard              | `Dashboard`                                                       | DESIGN INPUT REQUIRED | organisation dashboard recommendations, documents, tenders             | Counts and next actions must use real API data |
| Approved tender centre          | `TenderCentre`                                                    | DESIGN INPUT REQUIRED | tender list/create APIs                                                | Readiness is not client-derived                |
| Approved tender workspace       | `TenderWorkspace` and stage components                            | DESIGN INPUT REQUIRED | extraction, risk, evidence, checklist, RAG, draft, readiness, packages | Individual authority models remain separate    |
| Approved citation/source review | extraction, risk, RAG, draft, readiness components                | DESIGN INPUT REQUIRED | citations, source units, OCR provenance                                | No fake quotes or invalid trusted citations    |

## Known Limitations

- The approved redesign source was not provided in the Phase 18 attachment.
- External-user pilot validation has not been performed by automation.
- Provider-backed RAG and drafting cannot be certified without approved provider
  credentials and contractual approval.
- Production TLS, IAM, encryption, backup, and retention controls require external
  environment review.
- Independent penetration testing remains external to this engineering phase.

## Support Identifiers

Operators should collect the request ID shown in bounded API or UI errors, the
workflow step, browser viewport, account role, organisation name, tender title,
timestamp, and whether the issue occurred during scan, extraction, review,
readiness, package approval, download, or revocation. Do not collect passwords,
provider keys, private document contents, signed URLs, or database connection
strings in feedback reports.

## Rollback And Disable Strategy

- Revert the Phase 18 branch or PR to remove frontend/config/documentation changes.
- Disable provider-backed RAG or drafting using the existing provider-disable
  configuration if provider behavior is suspect.
- Stop worker processing for queue-related investigation without deleting Docker
  volumes or authoritative PostgreSQL data.
- Revoke controlled review packages rather than deleting package history.

## Pilot Success Criteria

- PILOT TARGET - TBD: user completes the first tender workflow without developer
  intervention.
- PILOT TARGET - TBD: user can identify the next required action.
- PILOT TARGET - TBD: user can inspect a claim, citation, page/unit, and OCR
  provenance.
- PILOT TARGET - TBD: no critical authorization or tenant-isolation defect is found.
- PILOT TARGET - TBD: no uncaught browser error is observed during the golden flow.
- PILOT TARGET - TBD: time to first useful output is measured from synthetic data.

## Feedback Categories

- First-time comprehension
- Navigation and workspace hierarchy
- Source/citation confidence
- Human review and approval clarity
- Loading, empty, error, and success states
- Accessibility or keyboard issues
- Performance or repeated request concerns
- Security, privacy, or data-handling concerns

## Readiness Categories

- ENGINEERING READY: deterministic checks and real-stack synthetic validation pass.
- PILOT READY: engineering validation passes and the missing approved design source
  has either been integrated or accepted as deferred by product ownership.
- PRODUCTION EXTERNAL REVIEW REQUIRED: legal/regulatory review, provider
  contractual review, production infrastructure security verification, approved
  retention policy, backup authorization, and independent penetration testing.
