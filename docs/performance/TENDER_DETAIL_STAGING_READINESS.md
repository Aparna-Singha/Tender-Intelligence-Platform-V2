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

## Operator deployment and rollback: approval required, not executed

These steps require separate explicit authorization for an API build,
recreation, and temporary diagnostics. Schedule a short staging maintenance
window: API recreation can interrupt in-flight requests. Confirm the existing
environment targets approved staging data and choose an already approved
synthetic tender/session. Do not copy credentials into the build worktree.

Run in PowerShell on the verified laptop. Capture the current image and Compose
paths from the container, preserving the existing staging checkout and files:

```powershell
$apiName = 'tender-intelligence-staging-api-1'
$before = (docker inspect $apiName | ConvertFrom-Json)[0]
$originalContainerId = $before.Id
$oldImageId = $before.Image
$stagingRoot = $before.Config.Labels.'com.docker.compose.project.working_dir'
$composeFiles = $before.Config.Labels.'com.docker.compose.project.config_files'.Split(',')
if ($composeFiles.Count -ne 2) { throw 'Re-review the deployment configuration' }
$envFile = Join-Path $stagingRoot '.env.staging'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Staging environment file missing' }
Remove-Variable before

$approved = 'e264f2722f4f2f187fcbaae6b5501ca0bbd55049'
$buildRoot = Join-Path (Split-Path $stagingRoot -Parent) 'BidVeda-api-diagnostics-e264f27'
if (Test-Path -LiteralPath $buildRoot) { throw 'Choose a fresh build worktree path' }
git -C $stagingRoot worktree add --detach $buildRoot $approved
if ($LASTEXITCODE -ne 0) { throw 'Worktree creation failed' }
$candidateImage = "tender-api:$approved"
$rollbackImage = 'tender-api:before-stage-diagnostics-20261029'
docker image tag $oldImageId $rollbackImage
if ($LASTEXITCODE -ne 0) { throw 'Rollback image preservation failed' }
docker build --label "org.opencontainers.image.revision=$approved" --tag $candidateImage --file (Join-Path $buildRoot 'infrastructure/docker/api.Dockerfile') $buildRoot
if ($LASTEXITCODE -ne 0) { throw 'Candidate build failed; leave the running API untouched' }
```

The image build runs no migrations. The source diff from the running image's
tag to the approved revision contains no schema or migration changes. Retain
the old image; do not prune it. Before replacing the API, verify the candidate
contains the hook without starting the application or supplying credentials:

```powershell
@'
const fs = require('node:fs');
if (!fs.existsSync('/app/dist/common/tender-detail-timing.js') ||
    !fs.readFileSync('/app/dist/main.js', 'utf8').includes('beginTenderDetailTiming'))
  process.exit(1);
console.log('Diagnostic artifact present');
'@ | docker run --rm -i --network none --entrypoint node $candidateImage
if ($LASTEXITCODE -ne 0) { throw 'Candidate artifact verification failed' }

$operationDir = Join-Path ([IO.Path]::GetTempPath()) ('bidveda-diagnostics-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $operationDir | Out-Null
$diagnosticFile = Join-Path $operationDir 'diagnostics.yml'
$disabledFile = Join-Path $operationDir 'disabled.yml'
$rollbackFile = Join-Path $operationDir 'rollback.yml'
@"
services:
  api:
    image: $candidateImage
    environment:
      API_TENDER_LATENCY_DIAGNOSTICS: "true"
"@ | Set-Content -LiteralPath $diagnosticFile -Encoding ascii
@"
services:
  api:
    image: $candidateImage
    environment:
      API_TENDER_LATENCY_DIAGNOSTICS: "false"
"@ | Set-Content -LiteralPath $disabledFile -Encoding ascii
@"
services:
  api:
    image: $rollbackImage
"@ | Set-Content -LiteralPath $rollbackFile -Encoding ascii
$composeArgs = @('--project-name', 'tender-intelligence-staging', '--project-directory', $stagingRoot, '--env-file', $envFile, '-f', $composeFiles[0], '-f', $composeFiles[1])
docker compose @composeArgs -f $diagnosticFile config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose validation failed' }
# Compare privately in memory: refuse unrelated environment drift.
$resolved = docker compose @composeArgs -f $diagnosticFile config --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Compose resolution failed' }
$candidate = (docker image inspect $candidateImage | ConvertFrom-Json)[0]
$live = (docker inspect $apiName | ConvertFrom-Json)[0]
$expectedEnv = @{}
foreach ($entry in $candidate.Config.Env) {
  $pair = $entry.Split('=', 2)
  $expectedEnv[$pair[0]] = $pair[1]
}
foreach ($entry in $resolved.services.api.environment.PSObject.Properties) {
  $expectedEnv[$entry.Name] = [string]$entry.Value
}
$actualEnv = @{}
foreach ($entry in $live.Config.Env) {
  $pair = $entry.Split('=', 2)
  $actualEnv[$pair[0]] = $pair[1]
}
$keys = @($expectedEnv.Keys) + @($actualEnv.Keys) | Sort-Object -Unique
$drift = @($keys | Where-Object {
  $_ -ne 'API_TENDER_LATENCY_DIAGNOSTICS' -and
  ($expectedEnv.ContainsKey($_) -ne $actualEnv.ContainsKey($_) -or
   $expectedEnv[$_] -cne $actualEnv[$_])
})
if ($drift.Count -ne 0) { throw 'Environment drift detected; private review required before recreation' }
Remove-Variable resolved,candidate,live,expectedEnv,actualEnv,entry,pair,keys,drift
if ((docker inspect $apiName --format '{{.Id}}').Trim() -ne $originalContainerId) {
  throw 'Another operation replaced the API; reassess before deployment'
}
docker compose @composeArgs -f $diagnosticFile up -d --no-build --no-deps --wait --wait-timeout 120 api
if ($LASTEXITCODE -ne 0) { throw 'API unhealthy: use rollback below' }
```

No existing environment file is edited. Temporary overrides contain no secrets;
`--no-deps` limits recreation to API. Never print the full resolved Compose
configuration or Docker environment. Keep the staging environment file unchanged
throughout the capture and rollback window. Verify the running image ID against the
candidate image ID, recheck the actual Node process flag (as below), and confirm
one authenticated request produces its correlated timing event. Use that request
as the first-request observation below. Health alone
does not prove instrumentation or authentication. Preserve Cloudflare Access,
host-only cookies, tenant checks and existing proxy behavior.

```powershell
@'
const fs = require('node:fs');
let found = false;
for (const pid of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
  try {
    if (fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() !== 'node') continue;
    const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (!args.some(x => /(^|\/)dist\/main\.js$/.test(x))) continue;
    found = true;
    const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    console.log(env.includes('API_TENDER_LATENCY_DIAGNOSTICS=true') ? 'DIAGNOSTICS_ENABLED' : 'DIAGNOSTICS_NOT_ENABLED');
  } catch {}
}
if (!found) process.exit(1);
'@ | docker exec -i $apiName node
```

After the approved capture, disable diagnostics on the reviewed image:

```powershell
docker compose @composeArgs -f $disabledFile up -d --no-build --no-deps --wait --wait-timeout 120 api
if ($LASTEXITCODE -ne 0) { throw 'API unhealthy: use rollback below' }
```

If deployment, authentication, or response behavior regresses, restore the
preserved image with the original environment-file configuration:

```powershell
docker compose @composeArgs -f $rollbackFile up -d --no-build --no-deps --wait --wait-timeout 120 api
if ($LASTEXITCODE -ne 0) { throw 'Rollback unhealthy; investigate without changing other services' }
$restored = (docker inspect $apiName | ConvertFrom-Json)[0]
if ($restored.Image -ne $oldImageId) { throw 'Rollback image mismatch' }
$restored.State.Health.Status
Remove-Variable restored
```

Verify login/session and the same approved GET through the normal browser path.
Do not run `down`, remove volumes, migrate databases, restart the worker, or
change Tunnel/DNS. Preserve temporary rollback instructions until validation
finishes. A normal future Compose recreation must select the intended reviewed
image explicitly; these temporary overrides do not update persistent deployment
configuration.

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

The interrupted command completed successfully and its existing logs were
recovered. No branch, worktree, source implementation, or test was recreated.
The only repository addition is this report. Application source, CI,
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
