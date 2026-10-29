# Tender detail API stage diagnostics

## Baseline and scope

The supplied correlated staging capture identifies
`GET /organisations/:organisationId/tenders/:tenderId` as an API-side slow
request: 3,648 ms in the browser, 3,480 ms in NestJS Pino, HTTP 200, with a
matching request ID. The difference is 168 ms for that one capture, not a
steady-state estimate of Vercel or Tunnel overhead. A read-only internal API
metrics snapshot on 2026-10-29 showed 1,860 successful tender-detail requests
and 4,091.84 accumulated API seconds (mean 2.200 s). These counters include
different workloads and do not identify a dominant stage.

Safe read-only probes from the running API container produced:

| Probe                                                     | Sequential durations      | Three modest concurrent durations |
| --------------------------------------------------------- | ------------------------- | --------------------------------- |
| Local `/health`, milliseconds                             | 40, 37, 3, 2, 1           | 2, 4, 5                           |
| `SELECT 1` via a **separate** Prisma client, milliseconds | 1,377, 113, 110, 113, 112 | 118, 786, 766                     |

The first query includes connection establishment. Concurrent queries can open
additional connections in this separate client. Neither probe measures the
running API client's pool wait or tender SQL, and `/health` does not exercise
authentication. The first database query and the concurrent values are not a
valid baseline for an authenticated tender request. Cold and warm behavior must
be assessed separately under an equivalent workload.

## Opt-in diagnostic implementation

`API_TENDER_LATENCY_DIAGNOSTICS` defaults to `false`. With an explicit `true`,
the API records only the registered tender-detail GET route. It emits one
structured Pino record per selected request with its existing `request_id`,
status, total duration and fixed numeric stage fields. The internal metrics
listener also exposes
`tip_api_tender_detail_stage_duration_seconds{stage}`. The listener remains
bound to `API_METRICS_HOST:API_METRICS_PORT`; it is not an API route.

| Stage                           | What it measures                                                          |
| ------------------------------- | ------------------------------------------------------------------------- |
| `session_authentication`        | Cookie read, session lookup, and active-organisation membership check     |
| `organisation_authorization`    | Requested-organisation membership lookup and permission decision          |
| `tender_primary_query`          | Awaiting the primary nested Prisma tender read                            |
| `processing_jobs_query`         | Awaiting the current-version processing-job read, when present            |
| `decorator_parallel_queries`    | Wall time for the four concurrent `decorateTenders()` read groups         |
| `decorator_draft_version_query` | Awaiting the conditional draft-version read                               |
| `response_mapping`              | Synchronous tender response mapping                                       |
| `post_handler_pre_send`         | Framework processing after the controller result, including serialization |
| `send_to_response`              | Time from Fastify `onSend` to `onResponse`                                |
| `unattributed`                  | Remaining request time, including hook and orchestration gaps             |

The stage values use monotonic timers. The parallel decorator value is **wall
time**, not a sum of four query durations. Prisma await times include any
connection acquisition, adapter overhead, network travel, and SQL execution;
they cannot safely separate those components in this adapter configuration.
No query parameters, SQL, cookies, credentials, user or tender data, signed
URLs, or identity IDs are logged. The request ID appears only in the private
structured log, never as a metric label. Metrics have only the fixed `stage`
label. Diagnostics stay off by default, and no environment file or running
service was changed in this work.

## Next measurement and decision gate

In a reviewed isolated staging diagnostic run, explicitly enable the flag for
a bounded interval, collect the private timing record for a correlated request
ID, and compare multiple cold and warm requests. Use sequential and modest
concurrent request groups with the same authenticated read-only fixture. Watch
the internal stage histograms and dependency status at the same time. Disable
the flag after capture. Do not send the private timing log to browser clients.

If the primary or decorator Prisma await dominates, distinguish SQL execution
from connection wait through safe database-side telemetry before changing query
shape or pool settings. If `post_handler_pre_send` dominates, inspect response
size and serialization without logging contents. If `unattributed` dominates,
inspect framework hooks and request scheduling. Preserve membership revocation,
tenant filters, deadline and workflow authority, and the response contract in
any later optimization.

No API optimization or before/after speedup is claimed here. This commit is
diagnostic only; its new flag is off by default. Rollback is reverting the
diagnostic commit. No migration is required.
