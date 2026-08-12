# Phase 15 Observability And Operational Hardening

Phase 15 adds vendor-neutral operational visibility without changing product
authority. Audit records remain the source of security and business history;
logs and metrics are diagnostic telemetry only.

## Architecture

- API and worker continue to use Pino through `@tender/observability`.
- Metrics use `prom-client` with one registry per process.
- API metrics are served from `API_METRICS_HOST:API_METRICS_PORT`, defaulting
  to `127.0.0.1:4100`.
- Worker metrics are served from `WORKER_METRICS_HOST:WORKER_METRICS_PORT`,
  defaulting to `127.0.0.1:4101`.
- Production infrastructure must restrict those listeners to trusted scrapers or
  internal networking. They are not frontend routes and must not be internet
  exposed.

OpenTelemetry tracing is not introduced in this phase. Request IDs already
provide the required API-to-worker correlation with lower dependency and runtime
risk. Full distributed tracing remains a future deployment option.

## Correlation

The root correlation ID is the existing validated request ID.

```text
HTTP request
  -> request_id in API log and response envelope
  -> audit record requestId where applicable
  -> bounded BullMQ payload requestId
  -> worker job_started/job_completed/job_failed log request_id
```

Every current API queue producer was audited:

| Job family                           | Correlation status           |
| ------------------------------------ | ---------------------------- |
| company document processing          | `requestId` added to payload |
| company document deletion            | `requestId` added to payload |
| tender document processing           | already carried `requestId`  |
| extraction                           | already carried `requestId`  |
| early risk analysis                  | already carried `requestId`  |
| evidence comparison                  | already carried `requestId`  |
| checklist generation                 | already carried `requestId`  |
| RAG indexing and answers             | already carried `requestId`  |
| fact-constrained drafting            | already carried `requestId`  |
| final-readiness audit                | already carried `requestId`  |
| controlled review package generation | already carried `requestId`  |

Queue payloads still exclude document contents, prompts, evidence text, emails,
signed URLs, and object-storage keys.

## Structured Logs

API 5xx logs include safe fields:

- `service`
- `environment`
- `request_id`
- `method`
- normalized `route`
- `status_code`
- `status_class`
- `error_category`
- `error_type`

Worker lifecycle logs include:

- `event`: `job_started`, `job_completed`, `job_failed`, or `job_timed_out`
- `request_id`
- `job_id`
- `job_name`
- `attempt`
- `duration_seconds` on terminal events
- bounded `error_category` and `error_type` on failures

Expected bounded client errors do not produce noisy stack traces through the API
exception filter.

## Redaction

Shared Pino redaction covers authorization headers, cookies, CSRF tokens,
request bodies, passwords, secrets, tokens, API keys, signed URLs, database URLs,
S3 secrets, provider keys, prompts, source text, and raw document text.

Do not add request/response body logging globally. Log safe metadata and stable
error classes/categories instead.

## Metrics

API metrics:

- `tip_api_requests_total{method,route,status_class}`
- `tip_api_request_duration_seconds{method,route,status_class}`
- `tip_api_in_flight_requests`
- `tip_api_unexpected_errors_total{route}`
- `tip_api_dependency_unavailable_total{route}`

Worker metrics:

- `tip_worker_jobs_started_total{job_name}`
- `tip_worker_jobs_finished_total{job_name,outcome}`
- `tip_worker_job_duration_seconds{job_name,outcome}`
- `tip_worker_job_queue_wait_seconds{job_name}`
- `tip_worker_jobs_active{job_name}`
- `tip_worker_job_retries_total{job_name}`
- `tip_worker_jobs_stalled_total{job_name}`
- `tip_worker_ready`

Metric labels must never contain request IDs, session IDs, organisation IDs,
tender IDs, document IDs, job IDs, run IDs, user IDs, emails, object keys, raw
URLs, prompts, source excerpts, or raw error messages.

## Health And Readiness

Liveness answers whether the process is alive. Readiness answers whether the
process can safely accept its work.

API readiness requires PostgreSQL, Redis, and object storage because API
workflows depend on those services for authority, queueing, and private
document storage.

Worker readiness requires PostgreSQL, Redis, and BullMQ queue connectivity.
ClamAV and object storage are mandatory for document-processing jobs and fail
closed in those processors; their outage behavior is documented in the runbook.

## Queue Reliability Audit

| Job family                  | Attempts/backoff                     | Timeout            | Duplicate-delivery guard                             |
| --------------------------- | ------------------------------------ | ------------------ | ---------------------------------------------------- |
| company document processing | 3 attempts                           | document timeout   | version/document state updates and extraction upsert |
| company document deletion   | no automatic retry                   | document timeout   | deletion marker and `deletedAt` guard                |
| tender document processing  | configured producer attempts         | document timeout   | document/run state checks                            |
| extraction                  | configured producer attempts/backoff | extraction timeout | extraction run authority and currentness checks      |
| early risk analysis         | configured producer attempts/backoff | extraction timeout | risk run authority/currentness                       |
| evidence comparison         | configured producer attempts/backoff | extraction timeout | assessment run authority/currentness                 |
| checklist generation        | configured producer attempts/backoff | extraction timeout | checklist run authority/currentness                  |
| RAG indexing/answers        | configured producer attempts/backoff | RAG timeout        | run/job state and tenant filtering                   |
| fact-constrained drafting   | configured producer attempts/backoff | draft timeout      | draft generation run authority/currentness           |
| final-readiness audit       | configured producer attempts/backoff | extraction timeout | final-readiness run authority/currentness            |
| controlled review package   | configured producer attempts/backoff | document timeout   | controlled package run approval/currentness checks   |

Retries were not broadly changed. Where retry safety depends on domain state,
processors continue to use existing authoritative records rather than metrics or
logs.

## SLIs

These are engineering objectives / TBD, not contractual SLAs.

- API availability/error rate:
  `sum(rate(tip_api_requests_total{status_class=~"5xx"}[5m])) / sum(rate(tip_api_requests_total[5m]))`
- API latency:
  `histogram_quantile(0.95, sum(rate(tip_api_request_duration_seconds_bucket[5m])) by (le, route, method))`
- Worker success/failure rate:
  `sum(rate(tip_worker_jobs_finished_total{outcome!="completed"}[5m])) by (job_name, outcome)`
- Worker processing latency:
  `histogram_quantile(0.95, sum(rate(tip_worker_job_duration_seconds_bucket[5m])) by (le, job_name))`
- Queue wait latency:
  `histogram_quantile(0.95, sum(rate(tip_worker_job_queue_wait_seconds_bucket[5m])) by (le, job_name))`
- Timeout rate:
  `sum(rate(tip_worker_jobs_finished_total{outcome="timed_out"}[5m])) by (job_name)`
- Dependency readiness:
  API and worker `/ready` responses plus `tip_worker_ready`.

## Operator Queries

- API error rate rising:
  `sum(rate(tip_api_requests_total{status_class=~"5xx"}[5m])) by (route)`
- Slow API routes:
  `histogram_quantile(0.95, sum(rate(tip_api_request_duration_seconds_bucket[5m])) by (le, route, method))`
- Workers processing jobs:
  `sum(rate(tip_worker_jobs_started_total[5m])) by (job_name)`
- Job type failing:
  `sum(rate(tip_worker_jobs_finished_total{outcome!="completed"}[5m])) by (job_name, outcome)`
- Queue wait increasing:
  `histogram_quantile(0.95, sum(rate(tip_worker_job_queue_wait_seconds_bucket[5m])) by (le, job_name))`
- Jobs timing out:
  `sum(rate(tip_worker_jobs_finished_total{outcome="timed_out"}[5m])) by (job_name)`

## Troubleshooting Runbook

When a user supplies a request ID:

1. Find the API structured log with `request_id`.
2. Check `route`, `status_code`, `status_class`, and `error_category`.
3. If the request enqueued async work, search worker logs for the same
   `request_id`.
4. Compare `job_started` with `job_completed`, `job_failed`, or `job_timed_out`.
5. Use safe `job_id` and run identifiers from logs to inspect authoritative
   database records.
6. Check `/ready` and metrics for dependency failures or queue wait growth.

Dependency guidance:

- PostgreSQL unavailable: expect readiness failure and bounded API `503`.
  Preserve data; restore PostgreSQL and re-check migrations/doctor.
- Redis or queue unavailable: queue-dependent requests must not be claimed as
  enqueued unless BullMQ accepted the job. Restore Redis and re-check readiness.
- MinIO unavailable: storage-dependent uploads/downloads fail safely. Do not mark
  missing private objects as approved.
- ClamAV unavailable: document scanning fails closed and unscanned content must
  not become clean/approved.
- Job timeout: inspect `job_timed_out`, authoritative run failure state, and
  queue retry policy before retrying manually.
- Worker restart: do not delete Redis data. Let BullMQ recover queued/stalled
  work, then verify authoritative state before replaying.
- Repeated job failure: inspect safe error category/type, dependency readiness,
  and domain run state. Do not delete data as a first response.

## Known Limitations

- API readiness metrics are request-derived; dependency-specific readiness
  gauges are not yet exposed for every dependency.
- Real-stack outage validation must be recorded in the PR from the executing
  environment.
- OpenTelemetry traces are intentionally deferred.

## Phase 16 Boundary

This phase does not add OCR, AI quality evaluation, RAG benchmarks, drafting
entailment evaluation, or provider cost evaluation.
