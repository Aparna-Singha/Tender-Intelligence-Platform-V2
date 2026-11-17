# API maintenance admission and drain

The API starts with maintenance **off**. It has no environment switch and no
unauthenticated toggle. A current session for a `PLATFORM_ADMIN` user and the
existing origin and CSRF checks are required for `POST /maintenance/enable`
and `POST /maintenance/disable`. `GET /maintenance` exposes the state, and
`GET /maintenance/reconciliation` returns bounded, aggregate database and
queue diagnostics, to the same authenticated role. Maintenance status reports
admission, consumer suspension, transition, and accepted-request count
separately; admission closure alone never proves drain. The mode is process-local
and resets on API restart.

Enabling closes API admission synchronously, waits up to 30 seconds for
previously accepted application requests to finish, then locally pauses the
API's workflow-progression BullMQ consumer. The pause waits for its active
jobs, with a 120-second response deadline. The response succeeds only after
both steps complete. An API drain timeout reopens admission because consumer
suspension has not started. A failed or timed-out consumer pause leaves API
admission closed and requires operator investigation; it must never be treated
as proof of drain. BullMQ pause is not cancelled at the deadline. If it later
settles successfully, the operator can disable maintenance. Disabling resumes the local
consumer before reopening admission. These controls do not pause global
BullMQ queues or change existing jobs.

While enabled, `/health` and `/ready` remain available. The authenticated
maintenance endpoints remain available to the operator. Other API operations,
including requests arriving through Vercel, Cloudflare, or direct access,
receive 503 with `Retry-After: 60`. The in-flight metric counts all HTTP
requests; the application drain counter excludes operational routes and
requests rejected by maintenance. A client disconnect, request abort, or
timeout is counted once. This drain proves only that accepted API HTTP
requests have ended. An aborted or disconnected request releases the HTTP
metric but remains unresolved in the application drain unless a completed
response is observed. This conservative count can block maintenance even if
the handler later finishes; it avoids treating a lost socket as proof that
database or queue work has stopped. It does not prove that the old staging worker's recovery
sweep or an external queue producer is idle.

Previously issued presigned object-storage upload URLs remain valid until
their original expiry. The API upload TTL defaults to 300 seconds and allows
up to 900 seconds. Maintenance cannot revoke those URLs or stop direct object
uploads. API completion requests are rejected, so a completed object may
remain in quarantine until admission and recovery resume. Check active
uploads and wait for URL expiry before any worker maintenance decision.

## Read-only reconciliation

Run these queries only with a separately approved, read-only connection to the
intended database. Keep identifiers out of shared logs. Do not infer recovery
idleness from zero queue counts or the absence of a row in `pg_stat_activity`.
The operator-only reconciliation endpoint makes the same bounded checks: it
reports counts of unexpired pending and completed-unapproved upload sessions,
compares up to 100 stable document-version job IDs with the primary queue, and
reports counts for both queues. Its response deadline is 10 seconds; a timed
out read is reported as unavailable without disclosing a database or Redis
error. It deliberately reports
`recoveryIdleProven: false` because these snapshots cannot observe an old
worker recovery sweep between its database read and Redis write.
Database and Redis observations are non-atomic and can change while the
snapshot is being collected. Repeat the check after producer quiescence and
use it as evidence for operator review, not as an automatic stop permission.

```sql
BEGIN READ ONLY;
SELECT status, count(*)
FROM upload_sessions
WHERE status IN ('PENDING', 'COMPLETED')
GROUP BY status;

SELECT us.id AS session_id, us.document_version_id AS job_id,
       us.status, us.expires_at, dv.approved_object_key IS NOT NULL AS approved,
       d.status AS document_status, d.current_version_id
FROM upload_sessions AS us
JOIN document_versions AS dv ON dv.id = us.document_version_id
JOIN documents AS d ON d.id = dv.document_id
WHERE (us.status = 'PENDING' AND us.expires_at > now())
   OR (us.status = 'COMPLETED' AND dv.approved_object_key IS NULL)
ORDER BY us.created_at, us.id;
ROLLBACK;
```

For each completed, unapproved version, compare the version ID with the
stable BullMQ `process-company-document` job ID in the configured primary
queue using read-only Redis inspection. A missing job may indicate recovery
work still needed; a present job does not prove that processing or an
ambiguous Redis insertion has finished. Inspect active, waiting, delayed,
paused, waiting-children, and prioritized counts for both queues, preserving
historical failed jobs. Never retry or delete a job as part of this check.

The deployed old worker has no reliable recovery-idle signal. A forced stop
still requires a separate operational decision after quiescence, database and
queue reconciliation, and an explicit assessment of ambiguous writes. This
API change alone does not authorize the worker rollout or SIGKILL.
