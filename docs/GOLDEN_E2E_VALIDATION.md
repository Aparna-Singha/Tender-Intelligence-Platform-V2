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

The test uses synthetic fixture data and the real local stack configured by
Playwright:

- PostgreSQL for authoritative workflow state;
- API for authenticated browser actions and package/download operations;
- worker for controlled review-package generation;
- MinIO/object-storage configuration used by the controlled package path;
- Redis/queue configuration used by worker-backed jobs;
- ClamAV remains part of the real local stack readiness expected by the browser
  suite.

The fixture creates the longest currently supported authoritative workflow graph:

1. organisation and tenant memberships;
2. tender workspace and current tender version;
3. source document in `READY` state after security processing;
4. completed extraction with extracted unit/block and validated citation;
5. completed early risk run with cited finding;
6. human `CONTINUE` pursuit decision;
7. finalised evidence/eligibility assessment;
8. completed checklist generation with visible checklist item;
9. completed RAG index;
10. approved controlled draft with human review event;
11. completed final-readiness run and independent final disposition;
12. controlled review-package generation through the real browser/API/worker path;
13. independent review and approval;
14. authorised controlled download and artifact inspection;
15. supersession after regeneration;
16. revocation and history visibility.

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

No live Gemini validation is performed by this E2E. Provider-dependent upstream
artifacts are represented by deterministic synthetic fixture records created before
the browser workflow begins. The real browser/API/worker path is used for the
controlled package lifecycle.

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
