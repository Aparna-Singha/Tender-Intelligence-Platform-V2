# Golden E2E Validation

Status: release-validation browser coverage added.

This document describes the maintainable golden E2E path for the supported Tender
Intelligence workflow. It is an engineering validation, not a production-readiness
certification or evidence of an external user pilot.

## Test Path

Run the golden validation with:

```bash
pnpm test:browser
```

The golden workflow lives in:

```text
e2e/phase13-controlled-review-package.spec.ts
```

The primary test is:

```text
validates the release golden business workflow and downloaded artifact
```

## Workflow Covered

The test uses synthetic data and the real local stack configured by
Playwright:

- PostgreSQL for authoritative workflow state;
- API for authenticated browser actions and package/download operations;
- worker for upload security processing, extraction, risk, evidence, checklist,
  final-readiness, and controlled review-package jobs;
- MinIO/object-storage configuration used by document upload and controlled
  package paths;
- Redis/queue configuration used by worker-backed jobs;
- ClamAV remains part of the real local stack readiness expected by the browser
  suite.

The golden path has two deliberate segments.

### Real Application-Path Stages

The first segment creates and advances upstream workflow state through supported
application paths wherever those paths already exist:

1. authentication/session through the browser login flow and authenticated API
   calls with CSRF handling;
2. organisation creation through the organisation API;
3. company evidence upload through the upload-session API, signed object-storage
   upload, completion API, worker-backed security processing, and `READY`
   document state;
4. tender creation through the tender API;
5. tender document upload through the tender upload-session API, signed
   object-storage upload, completion API, worker-backed ClamAV/security
   processing, and `READY` tender-document state;
6. extraction/OCR job start through the extraction API and worker-backed
   completion;
7. early risk job start through the risk API and worker-backed completion;
8. human pursuit decision through the decision API;
9. company evidence fact creation, citation creation, and human evidence review
   through evidence APIs;
10. eligibility/evidence assessment start through the assessment API,
    worker-backed completion, evidence linking, and human assessment review
    through APIs;
11. checklist generation through the checklist API and worker-backed completion;
12. final-readiness start through the final-readiness API, worker-backed
    completion, and independent human disposition through the decision API.

The second segment keeps the existing controlled-package validation unchanged and
exercises the real browser/API/worker path for:

1. controlled review-package generation;
2. independent review and approval;
3. authorised controlled download and ZIP artifact inspection;
4. supersession after regeneration;
5. revocation and history visibility.

### Fixture-Backed Provider Stages

Live provider-backed RAG and drafting are not run in this release-validation E2E.
Those segments remain deterministic fixture-backed because live Gemini validation
belongs to the provider release-validation path, not this browser suite:

- completed RAG index records use explicit fixture provider/model metadata;
- approved draft generation and human draft review records use explicit
  fixture-backed policy/provider metadata.

The controlled-package segment still uses the existing deterministic Phase 13
fixture graph for its package prerequisites so the previously validated package
lifecycle remains stable while the upstream application-path workflow is covered
independently in the same golden test.

### Direct Database Use

Direct Prisma access is limited to:

- cleanup of synthetic validation records;
- read-only authoritative assertions after application-path operations;
- adding test-only reviewer/admin membership wiring for synthetic users after
  organisation creation;
- deterministic fixture-backed RAG/draft bridge records;
- the existing controlled-package fixture data used by the package lifecycle.

## Assertions

The golden test asserts more than route loading:

- organisation and tender IDs remain tenant-scoped;
- the source document is usable only after `READY` processing state;
- extraction/OCR-compatible extracted units exist;
- validated citations and provenance exist;
- early risk, pursuit decision, eligibility, checklist, RAG, draft, readiness, and
  final disposition records are authoritative;
- workspace stages render the expected user-facing surfaces;
- requester self-approval for package download remains blocked;
- independent reviewer approval is required;
- controlled download produces the expected ZIP members and checksum manifest;
- generated package artifacts do not contain active PDF actions or secret-like
  values;
- superseded packages become historical;
- revoked packages no longer expose the authorised download control.

## Negative Checks

The browser suite also keeps focused negative coverage:

- platform admin without tenant membership cannot access the tender workspace;
- cross-tenant owner cannot access another tenant's tender workspace;
- requester cannot self-approve controlled package download;
- revoked package state removes the controlled download action;
- mobile rendering does not introduce horizontal page overflow for the package
  surface.

## Provider Handling

No live Gemini validation is performed by this E2E. Provider-dependent RAG and
drafting artifacts are represented by deterministic synthetic fixture records with
fixture provider/policy metadata. The real application path is used for upstream
non-provider stages and for the controlled package lifecycle.

## Browser Quality

The golden test records browser console errors, uncaught page errors, and failed
network requests during the exercised flow. Benign Next.js navigation aborts are
ignored; non-aborted request failures are treated as defects.

The controlled artifact inspection also checks that signed URLs, credentials,
private object keys, and local paths are not exposed in the downloaded provenance
or package content.

## Known Limitations

- This does not prove production capacity or production infrastructure security.
- This does not run a live provider-backed Gemini RAG or draft evaluation.
- This does not replace Phase 17 security suites or external penetration testing.
- This does not claim real-user pilot completion.
- This does not exercise destructive outage, backup, or recovery procedures.
