# Tender-detail measurement readiness review

Assessment started 2026-10-29; runtime readiness and CI rechecked 2026-10-30.
Repository base:
`e264f2722f4f2f187fcbaae6b5501ca0bbd55049` (fetched `origin/main`).
**Live stage measurements: BLOCKED. Latency root cause: unverified.**
No application optimization, migration, deployment, restart, secret change,
or new benchmark against staging was performed for this assessment.

## Independently verified state

- PR #38 merged as `c2dca848ebaaf499bc000155e9eb454abb8c0e44`;
  PR #39 merged as `e264f2722f4f2f187fcbaae6b5501ca0bbd55049`.
- [Main CI run 40899091191](https://github.com/Aparna-Singha/Tender-Intelligence-Platform-V2/actions/runs/40899091191)
  passed Windows, Ubuntu, Redis integration, and BidVeda mail Worker checks.
- [Main Security run 40899090705](https://github.com/Aparna-Singha/Tender-Intelligence-Platform-V2/actions/runs/40899090705)
  passed secret scan. Dependency review was skipped because this was a push;
  its workflow condition enables it for pull requests. CI needs no correction.
- Docker context is `desktop-linux`, Linux/x86_64 on Docker Desktop. The
  staging API, worker, Redis, and ClamAV containers are running and healthy.
  Compose labels identify `docker-compose.staging.yml` followed by
  `docker-compose.laptop.yml` in the existing staging checkout. Caddy is not
  running in this project. Only the API publishes a host port, on loopback 4000.
- The Windows Cloudflared service is running. API process configuration was
  classified without printing values: Neon pooled hostname, R2 endpoint,
  internal `redis` service, and the expected staging web origin are configured.
  This does not prove external connectivity or current Vercel/Tunnel routing;
  validate that path before the browser capture. The legacy `API_PUBLIC_URL`
  environment entry is not referenced by current API/config source and is not
  evidence of the active Tunnel ingress. No configuration was changed.
- The running API image is tagged
  `tender-api:b455655860beade95363e5f4bb80279a73ad0689`, with image ID
  `sha256:278bb2e9d6ea79f9aa10d2f528470a9da90f9fb7e240b4468f2ec9d943a25bcb`.
  It started on 2026-10-27 and has no container OCI revision label. A tag alone
  is not proof of source provenance. Compiled `/app/dist/main.js` has no
  `beginTenderDetailTiming` hook and the timing module is absent: this running
  artifact does not include PR #39's implementation.
- The packaged Prisma schema and current main schema have matching SHA-256
  hashes after CRLF normalization. This verifies packaged schema agreement,
  not the live database's migration state; no database query was run here.
- The actual Node process running `dist/main.js`, identified through `/proc`,
  has no `API_TENDER_LATENCY_DIAGNOSTICS` entry. Only the classification
  `UNSET_DEFAULT_DISABLED` was emitted. PID 1 is the init process, so its
  environment alone was not used as proof of the API process state.

The locally running stack matches the laptop deployment. The Oracle ARM64
configuration is repository preparation, not evidence of an Oracle deployment.
The stated browser path is Vercel -> Cloudflare Access/Tunnel -> laptop API;
only the local services and configuration categories above were verified here.
Existing development containers and unrelated containers were left alone.

## Request trace and diagnostic boundaries

The reviewed code path is:

1. Fastify request hook and global guards. This GET has no rate-limit policy;
   `RateLimitGuard` returns without Redis. `CsrfGuard` permits safe GET methods.
2. `AccessGuard` authenticates the cookie through `SessionService`: a session
   lookup including its user, expiry/revocation checks, and a conditional read
   validating active organisation membership. Requested organisation membership
   and `TENDER_READ` permission are checked separately on every request.
3. `TendersController.get` calls `TendersService.get`. The primary Prisma read
   is scoped by organisation, tender ID and `deletedAt`. It includes versions,
   documents, active workflow runs, sources, corrigenda and workspace.
4. A conditional current-version processing-job query returns at most 20 jobs.
5. `decorateTenders` starts up to four concurrent read groups for deadlines,
   pursuit decisions, drafts and draft-generation runs, followed by a
   conditional draft-version read. It derives deadlines and workflow state.
6. Final mapping converts document byte counts to strings. The response
   interceptor adds the request ID; Fastify serializes and sends the response.

This path has no direct R2, Gemini, mail, or BullMQ job call. Background work
could still compete for resources; that is an unmeasured alternative, not an
identified cause. Multiple Prisma reads do not establish SQL statement counts:
relation loading can issue additional SQL. No SQL plan or pool-wait evidence
was collected, so no N+1, missing index, or pool-size defect is claimed.

PR #39 already measures the required application stages using monotonic
timers, a request-scoped WeakMap, fixed stage fields, and internal histograms.
It logs no body, SQL, SQL parameters, session, cookie, tender ID or user ID.
Request IDs are private log correlation fields, never metric labels. The
parallel decorator stage is wall time; its individual queries are not split.
The decorator's synchronous calculations fall into `unattributed`, whereas
`response_mapping` measures the final mapping. `post_handler_pre_send` includes
framework/serialization work, not a pure serializer benchmark.

The singleton Prisma client uses `PrismaPg`, `max: 10`, and a 5-second
connection-acquisition timeout. Prisma await duration combines pool acquisition,
adapter processing, network and database execution. None can yet be isolated.
The flag is parsed at startup and controls hook registration: changing a shell
variable or using `docker exec -e` does not enable the running API. A reviewed
image and API container recreation are required. Stage logs are emitted at
info level; verify the configured log level permits them before collecting.

The historical 3,648 ms browser / 3,480 ms API capture and approximately 2.2 s
aggregate remain historical observations. The separate Prisma probe in
[the diagnostic report](TENDER_DETAIL_STAGE_DIAGNOSTICS.md) uses a different
client. No new cold/warm samples, p50/p95, error rate, or before/after speedup
are available. Authentication, connection/network overhead, relation loading,
SQL execution, response processing, and host contention remain alternatives.

## Operator deployment and rollback: separate approval required

The original local Markdown contained executable PowerShell source, not the
`[*0*]`, `*@*`, bold delimiters or HTML entities seen in the pasted copy.
Those were paste artifacts. The substantive corrections below remove
session-dependent rollback and strengthen the operational gates.

The supporting [operator script](../../tools/operations/tender-diagnostics.ps1)
requires Windows PowerShell 5.1+, Python 3.9+ (`python` on PATH, standard library
only), Docker Desktop's `desktop-linux` context and
this exact reviewed revision. It does not modify Compose files or environment
files. Its `Capture` and `Preflight` actions are read-only against Docker.
`Stage`, `Enable`, `Disable`, `Rollback` and `Correlate` require explicit
operator approval; the `-Approved` argument records that approval, it does
not grant it. Do not execute those actions under this documentation-review task.

The earlier `tender-intelligence-staging-20261030` bundle is preserved unchanged.
It predates the final checks and is **not approved for deployment**. All commands
below use a new `-final-review` bundle; do not copy scripts into the old bundle
or bypass its checksums. Capture the new bundle before any approved Stage.

### Persistent preparation, without changing containers

Run the following from the measured-performance worktree only after reviewing
the script. `Capture` refuses an existing bundle; never delete or overwrite an
older recovery bundle to bypass that check. The default location is stable,
outside Git and outside temporary storage:
`%LOCALAPPDATA%\BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review`.

```powershell
& .\tools\operations\tender-diagnostics.ps1 -Action Capture
if ($LASTEXITCODE -ne 0) { throw 'Capture failed; stop.' }
& "$env:LOCALAPPDATA\BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review\Operator.ps1" -Action Preflight
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; stop.' }
```

The bundle holds `baseline.json`, an independent `Operator.ps1`, a standalone
`Rollback.ps1`, `verify-image-archive.py`, and `rollback.yml`. The verifier's
checksum is checked along with the scripts. ACL inheritance is disabled at the bundle
root; only the current Windows user and SYSTEM receive access, inherited by
files. It contains paths, immutable image/container IDs and SHA-256 digests,
not environment values, cookies, tokens or resolved Compose configuration.
Treat even these local operational identifiers and digests as private; do not
upload the bundle. Do not run these commands under a transcript/debug trace.
Raw native output and exceptions are suppressed; failures emit fixed messages.

Preflight rejects a different Docker engine/context/project, multiple API
replicas, the wrong service identity, or changes to the original input files.
It compares resolved Compose configuration privately with the captured running
API: environment, command/entrypoint, user, loopback-only port, resource limits,
health check, logging, networks, mounts and security options. Unsupported API
settings fail closed. Subsequent full configuration fingerprints permit only
the approved image and diagnostic flag to change, including checks on the
other services and top-level networks/volumes. Runtime fingerprints also guard
against changes outside Compose. No full config, environment or log is printed.

**Capture alone is not rollback readiness.** Before any replacement, the
original image must also be archived and its checksum verified in the next
step. Keep the original checkout, `.env.staging`, Compose files, Docker engine,
network identities, and worker/Redis/ClamAV containers intact. A Windows reboot
may change their start times; it must not replace their identities or config.
If these prerequisites drift, stop for private review rather than weakening
assertions or restoring secrets from an old snapshot.

### Approved candidate preparation and preservation

A separate approved build must produce a local Linux/amd64 API image from
`e264f2722f4f2f187fcbaae6b5501ca0bbd55049`, using the repository API Dockerfile
and OCI label `org.opencontainers.image.revision` set to that full SHA. Use a
clean build worktree with no staging secrets; do not build from the dirty
staging checkout. No build, image pull or migration is part of this procedure.
The label is an assertion by the builder, not cryptographic source attestation:
review source checkout/build provenance before approving the candidate.
The expected local tag below must resolve to that approved artifact.

```powershell
& "$env:LOCALAPPDATA\BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review\Operator.ps1" -Action Stage -CandidateImage 'tender-api:e264f2722f4f2f187fcbaae6b5501ca0bbd55049' -Approved
if ($LASTEXITCODE -ne 0) { throw 'Staging failed; do not replace API.' }
```

`Stage` rejects revision, platform, image command/user/security-policy or
environment drift. Before writing candidate artifacts it runs a disposable
inspection container pinned to the immutable candidate ID, with `--network none`,
no mounts, environment arguments or published ports, a read-only filesystem,
non-root user, dropped capabilities and bounded CPU/memory/process limits.
Its overridden Node entrypoint only reads compiled files: it never imports or
starts the API and needs no credentials. It requires the compiled diagnostic
module export, the main-module import and the expected `onRequest` hook and
flag-controlled `beginTenderDetailTiming(request, ..., startedAt)` call.
Missing instrumentation fails Stage before overrides, archive or candidate
manifest creation. These are static artifact checks, not proof of runtime hook
execution; the authenticated correlation gate remains mandatory.

It pins the candidate's immutable image ID, writes only
API image/flag overrides, validates the Compose merge in memory, and saves
`original-image.tar` with its checksum in `preservation.json`. The archive is
an image, not a container export: no runtime environment or volume is copied.
Image layers must already satisfy the repository's no-secret build rules;
checking image environment keys cannot prove historical layers are secret-free.
Do not prune/delete the archive. `candidate.json`, `enabled.yml` and
`disabled.yml` are also non-secret. Generated `.yml` files use JSON syntax,
which is valid YAML, avoiding PowerShell interpolation/quoting ambiguities.
An interrupted Stage requires review; artifacts are never silently overwritten.

The read-only Python verifier checks the saved tar structure, complete member
payloads and tar terminator, rejects duplicate/unsafe/link members, and requires
one Docker-save manifest. The referenced configuration's SHA-256 must equal the
captured original image ID; every referenced layer must match its configuration
`rootfs.diff_ids` (including gzip decompression when needed). OCI SHA-256 blob
paths are verified too. No files are extracted. Unexpected archive formats fail
closed. Stage writes `preservation.json` only after validation; recovery and API
replacement repeat both whole-archive checksum and structure/content checks.

**Load recovery remains UNVERIFIED.** Both available Docker contexts (`default`
and `desktop-linux`) identify the same engine; no separate disposable daemon was
available and no load rehearsal was performed. Do not load an archive into the
active engine as a rehearsal. A future rehearsal requires an independently
isolated daemon/storage and approval; it must recover the captured image ID.
Until then, every Enable/Disable requires the explicit
`-AcknowledgeUnrehearsedRecovery` switch as well as `-Approved`. This acknowledges
that structural/content verification cannot prove Docker load compatibility,
disk capacity or successful runtime recovery. It does not convert the result
to PASS. Emergency rollback does not require this additional acknowledgement.

### Approved API-only replacement and mandatory gates

Obtain explicit authorization for the maintenance window, API recreation,
temporary diagnostics, bounded authenticated reads and automatic rollback on
failure. Confirm the fixture/session is approved and synthetic. API recreation
interrupts in-flight requests. Reserve disk space for the image archive before
beginning and prevent concurrent operator changes during the window.

```powershell
& "$env:LOCALAPPDATA\BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review\Operator.ps1" -Action Enable -Approved -AcknowledgeUnrehearsedRecovery
if ($LASTEXITCODE -ne 0) { throw 'Enable failed; no workload permitted.' }
```

All recreation commands target exactly `api` with `--no-deps --no-build
--pull never --wait --wait-timeout 120`. There is no `down`, volume removal,
migration, worker restart or resource provisioning. Original-image archive
integrity and candidate identity are checked before replacement. The script
checks API image/configuration, loopback binding, Docker health and internal
`/ready` status, then checks the **actual Node API process** flag through
`/proc` and the compiled timing hook. Worker, Redis and ClamAV IDs/configuration
and start times must be unchanged across the operation. Failure attempts
original-image rollback and prohibits workload; a rollback failure requires
private operator intervention, never changes to other services to force success.

Health is not proof of authentication. Before any workload, use the normal
Vercel -> Access -> Tunnel browser path with the existing approved session:

1. Confirm session and organisation context initialize normally. Do not copy
   cookies, export HAR files, bypass Access, or authenticate with the service
   token as a user. Confirm no unexpected redirects, cookie changes or errors.
2. Make exactly one approved tender-detail GET as described in the measurement
   plan below, supplying a fresh UUID request ID. Require HTTP 200, the expected
   response shape and tenant/fixture, and matching response request ID. Keep
   contents private. This is the first-request observation, not an extra probe.
3. Supply only that UUID twice and numeric status to the following gate. It
   reads at most 1,000 log lines from the last five minutes in memory, requires
   exactly one matching fixed-route stage event, and prints no log records.
   Missing, duplicate, invalid, or mismatched evidence triggers rollback.

```powershell
# Enter identifiers/status only; never paste cookies or response bodies.
$requestId = Read-Host 'Fresh request UUID sent by browser'
$responseId = Read-Host 'Matching response request UUID'
$status = [int](Read-Host 'Browser HTTP status')
& "$env:LOCALAPPDATA\BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review\Operator.ps1" -Action Correlate -RequestId $requestId -ResponseRequestId $responseId -BrowserStatus $status -Approved
if ($LASTEXITCODE -ne 0) { throw 'Gate failed; no workload permitted.' }
```

If login/session/response semantics fail before this gate, or during workload,
stop and run the standalone rollback below. Do not retry 401/403 or increase
load. Only start the bounded workload within five minutes of a successful gate
on the unchanged API. Keep the first request separate from warmed samples.
The script validates timing correlation, not response semantics or external
routing: those remain mandatory operator checks.

After a successful capture, disable diagnostics on the same reviewed image:

```powershell
& "$env:LOCALAPPDATA\BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review\Operator.ps1" -Action Disable -Approved -AcknowledgeUnrehearsedRecovery
if ($LASTEXITCODE -ne 0) { throw 'Disable failed; inspect rollback outcome privately.' }
```

Verify login/session and the approved GET again. Normal future Compose
operations must explicitly select the intended image; these local overrides
are not a persistent deployment configuration change.

### Standalone rollback after shell closure or Windows restart

Sign in as the Windows user who captured the bundle. Start Docker Desktop
normally and confirm the same engine is available. This command needs no
variables from an earlier session and no repository script to be present:

```powershell
& "$env:LOCALAPPDATA\BidVeda\TenderDiagnostics\tender-intelligence-staging-20261030-final-review\Rollback.ps1" -Approved
if ($LASTEXITCODE -ne 0) { throw 'Rollback failed; stop and investigate privately.' }
```

The launcher reads the durable manifest, checks ACLs, script checksums, original
input-file checksums and protected service identities, verifies the image
archive and loads it if needed, and restores only the API with its original
image ID and original unset diagnostic flag. An unrelated API replacement is
rejected. It verifies readiness, actual process flag, full runtime policy and
unchanged protected services. Finally verify session/authentication and the
same approved GET through the browser. If the engine, files or protected
services have changed, rollback intentionally stops; review privately instead
of discarding data or bypassing checks. Keep the bundle until the operator has
accepted recovery. Do not delete review artifacts or modify `.env.staging`.

## Bounded measurement plan after readiness passes

1. Record the API image ID, capture start/end time, fixture alias, and API
   uptime. Keep the synthetic tender state constant and avoid processing jobs,
   RAG, drafting, uploads, or other testers during the capture.
2. Use the authenticated browser's same-origin `/api/organisations/.../tenders/...`
   route. Preserve cookies through `credentials: 'include'`; do not extract
   cookies or use a direct API path that bypasses Access. Supply a fresh
   `crypto.randomUUID()` as `x-request-id` for each request and verify the
   response header or JSON envelope's `request_id` matches, without logging
   the response data. Use `cache: 'no-store'`, no redirects, and a 15-second
   request timeout. Consume the response without logging its contents.
3. Record one first authenticated request after the approved API recreation
   separately. Call it an API-first-request observation, not a proven Neon
   cold start: readiness checks/background activity may already warm the pool.
   Do not restart or suspend anything just to manufacture a cold sample.
4. Perform two excluded warmups, then 10 sequential requests. If health and
   host capacity remain acceptable, run three waves of concurrency 3 and then
   two waves of concurrency 5, with a two-second pause between waves. Maximum:
   32 requests including the first observation and warmups. Stop on a timeout,
   any non-200 (including 401/403), unhealthy service, or sustained resource
   pressure; do not retry or escalate load. Use a maximum ten-minute capture window.
5. Record browser total duration and TTFB in DevTools, status, and request ID.
   Do not export a raw HAR. From bounded Docker logs since capture start,
   parse JSON privately and select only the matching IDs and the
   `tender_detail_stage_timing` event. Export only `request_id`, `status_code`,
   `duration_ms`, and the fixed numeric `stages_ms` fields documented in
   [the stage reference](TENDER_DETAIL_STAGE_DIAGNOSTICS.md). For matching
   ordinary Pino completion records, retain only request ID and `responseTime`.
   Do not print raw log lines, paths with identity IDs, request headers, or bodies.
6. For each concurrency group, report successful sample count, average, minimum,
   maximum, p50, p95, and errors/all attempts. Specify nearest-rank percentiles; with only
   9-10 samples, p95 is effectively the maximum and is not statistically
   definitive. Keep warmups, first-request observations and failures separate.
   Compute stage contributions using paired successful records; do not sum
   stage p95 values. Mark conditional draft-version measurements as absent
   when that query did not run, not as an observed zero-duration query.
7. Disable diagnostics and retain only the sanitized capture outside the
   repository. If Prisma await dominates, obtain safe pool/database telemetry
   and parameter-redacted query plans before changing queries or indexes.
   If the parallel group dominates, it does not identify its slowest member.
   If framework or residual time dominates, inspect CPU and response size
   without recording response contents. Any later optimization needs the same
   fixture, state, infrastructure and concurrency for its comparison.

No before/after table is populated because no eligible live sample exists.
The next decision is approval for this bounded API deployment/capture, followed
by actual correlated stage evidence. No performance-fix PR is justified yet.

## Recovered verification and final disposition

### Operator hardening and final safety validation, 2026-10-30

The earlier review's read-only Capture/Preflight passed and its restricted
bundle remains unchanged at the original path (without `-final-review`). The
final review does not promote that older script copy to deployment-ready.
The new bundle has not been captured; operators must run Capture using the
revised script and the new default path before approved candidate preparation.
No Stage, Enable, Disable, Rollback or Correlate action was executed.

- **PASS:** 44 offline PowerShell assertions, including Stage failing on missing
  instrumentation before artifact writes, network-disabled immutable-image
  inspection arguments, and refusal to recreate without recovery acknowledgement.
  All native Docker boundaries in these tests are mocked.
- **PASS:** nine Python unittest methods, including six isolated Node-probe
  cases and synthetic Docker-save archives: valid/plain and gzip layers,
  wrong image ID, missing/tampered layer or config, invalid manifest/linkage,
  unsafe paths, truncation, missing terminator, duplicate members and links.
  No Docker commands, credentials or real image archive are used.
- **PASS:** PowerShell syntax checks for the procedure fences and supporting
  scripts; Python syntax and isolated execution of the candidate Node probe.
  Static syntax validation does not prove native Docker execution.
- The earlier three synthetic Compose override syntax checks remain applicable;
  this follow-up does not change override structure or API-only Compose commands.
- **NOT RUN:** candidate inspection against a real image, original-image save or
  archive validation against that image, load rehearsal, live replacement,
  rollback after restart, external authentication/correlation and workload.
  Both available Docker contexts use the same engine, not isolated daemons.
- Full application gates below are historical and unchanged; they were not
  rerun for documentation/operator-only changes. No latency improvement is claimed.

Run the deterministic safety tests without touching Docker or staging:

```powershell
powershell -NoProfile -File tools/operations/test-tender-diagnostics.ps1
if ($LASTEXITCODE -ne 0) { throw 'Operator safety tests failed.' }
python -I -B tools/operations/test-image-archive.py
if ($LASTEXITCODE -ne 0) { throw 'Archive/probe safety tests failed.' }
```

### Previously recovered application verification

The interrupted command completed successfully and its existing logs were
recovered. No branch, worktree, source implementation, or test was recreated.
At that assessment, the only repository addition was this report. Application source, CI,
environment files, and staging containers were not changed.

The initial full test invocation incorrectly supplied `NEXT_PUBLIC_API_URL=/api`.
Six existing frontend mocks call `new URL(url)` without a base, so a relative
request URL throws before their expected-path branches execute. The GitHub
workflow instead specifies `NEXT_PUBLIC_API_URL=http://localhost:4000`.
The corrected full suite passed without changing any source or assertion.
On 2026-10-30 these exact six tests were independently rerun and passed:

- `app-shell-session-recovery.test.tsx`: bounded stale-session retry;
  manual recovery after `/auth/session` failure; manual recovery after
  `/organisations` failure; no retry on session 401; no retry on organisation 403.
- `dashboard-request-efficiency.test.tsx`: sharing concurrent session,
  membership, and tender-list reads.

The focused invocation applies settings only to its child test process:

```powershell
pnpm exec cross-env NEXT_PUBLIC_API_URL=http://localhost:4000 NODE_ENV=test pnpm --filter @tender/web exec vitest run src/components/app-shell-session-recovery.test.tsx src/components/dashboard-request-efficiency.test.tsx --reporter=verbose
```

The parent process environment was compared before and after and was unchanged.
The production build used `/api` and dummy HTTPS proxy/storage origins and
dummy Access credentials in its own command process. No environment file was
edited. Mocked tests and a successful build do not verify deployed routing.

| Check                                         | Status  | Evidence                                                                         |
| --------------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Frozen-lockfile installation                  | PASS    | Lockfile unchanged; no dependency upgrade                                        |
| Prisma client generation                      | PASS    | Generated 7.9.1 client with dummy database URL; no migration                     |
| Formatting                                    | PASS    | Repository Prettier check                                                        |
| Lint                                          | PASS    | 16 uncached Turbo tasks; Markdown lint passed                                    |
| Typecheck                                     | PASS    | 16 uncached Turbo tasks                                                          |
| Initial test invocation with relative URL     | FAIL    | Six mock URL-parsing failures; invocation corrected                              |
| Corrected full tests                          | PASS    | 16 uncached Turbo tasks; 757 tests passed, four opt-in integration tests skipped |
| Exact six frontend regressions                | PASS    | Six of six; child-process override; no source changes                            |
| Existing diagnostic tests                     | PASS    | Five API timing tests and one stage-metrics test within the full suite           |
| Security suites                               | PASS    | 12 config, 33 domain, 94 API, 25 worker tests                                    |
| Offline AI evaluation                         | PASS    | 16 cases, no failed cases; no provider calls                                     |
| Production build                              | PASS    | 10 uncached Turbo tasks with dummy build settings                                |
| Operator PowerShell and Node snippets         | PASS    | Syntax checks only; deployment commands not executed                             |
| Live Redis and database integration locally   | NOT RUN | Opt-in tests skipped; main CI independently passed Redis integration             |
| Browser E2E and live proxy validation         | NOT RUN | No staging change or authenticated browser fixture used                          |
| Authenticated stage baseline and before/after | BLOCKED | Running API lacks PR #39 and flag is unset                                       |

An authenticated approved synthetic fixture/session was not established; no
cookie or token was extracted to work around the deployment gate. The next
runtime step requires approval to build the reviewed API image, recreate only
the API with diagnostics temporarily enabled, and execute the bounded capture.
No regression in source behavior was demonstrated or fixed in this work.

**LIVE MEASUREMENT BLOCKED. LIVE PERFORMANCE IMPROVEMENT NOT VERIFIED.**
Review disposition: **DIAGNOSTIC-ONLY**.

Proposed documentation PR title:
`docs: record tender-detail diagnostic readiness and safe capture procedure`

Proposed description: The running laptop API predates PR #39 and has diagnostics
unset, so authenticated stage measurement cannot yet identify the latency cause.
This report records independently verified repository, CI and runtime evidence;
documents API-only deployment, flag disablement and rollback commands requiring
operator approval; and defines a bounded correlated measurement plan. It also
records the corrected frontend test invocation and completed local quality
gates. No application optimization, migration, CI change or deployment is included.
No PR was opened or pushed.
