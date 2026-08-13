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

The test uses synthetic data and the real local stack configured by Playwright:

- PostgreSQL for authoritative workflow state;
- API for authenticated browser actions and package/download operations;
- worker for upload security processing, extraction, risk, evidence, checklist,
  final-readiness, and controlled review-package jobs;
- MinIO/object-storage configuration used by document upload and controlled
  package paths;
- Redis/queue configuration used by worker-backed jobs;
- ClamAV remains part of the real local stack readiness expected by the browser
  suite.

The primary golden E2E now uses one continuous synthetic tender/workflow graph.

The same tender is exercised through:

- authenticated application access;
- organisation creation;
- company evidence upload and worker-backed security processing;
- tender creation;
- tender document upload and ClamAV processing;
- extraction/OCR;
- early risk analysis;
- human pursuit decision;
- evidence fact/review and eligibility assessment;
- checklist generation;
- final readiness and independent human disposition;
- controlled review-package generation;
- independent review and approval;
- controlled download and artifact inspection;
- package supersession;
- revocation and history.

The workflow uses the real API/worker/database/storage paths where supported.

The separate responsive/forbidden-access regression still uses the existing
deterministic Phase 13 fixture graph because it provides stable tenant and role
coverage independent of the primary release golden workflow.

### Direct Database Use

Direct Prisma access is limited to:

- cleanup of synthetic validation records;
- read-only authoritative assertions after application-path operations;
- adding test-only reviewer/admin membership wiring for synthetic users after
  organisation creation;
- deterministic fixture-backed RAG/draft bridge records;
- the existing Phase 13 fixture data used only by the separate
  responsive/forbidden-access regression.

## Assertions

The golden test asserts more than route loading:

- organisation and tender IDs remain tenant-scoped;
- the source document is usable only after `READY` processing state;
- extraction/OCR-compatible extracted units exist;
- extraction provenance exists where produced by the real extraction path;
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

Live Gemini/provider validation is intentionally not part of this PR.

RAG index and draft generation/review are the only deterministic fixture-backed
stages in the primary golden flow. They are tied to the same organisation, tender
and tender version used by the real upstream and controlled-package workflow.

Live provider validation will be handled separately.

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
