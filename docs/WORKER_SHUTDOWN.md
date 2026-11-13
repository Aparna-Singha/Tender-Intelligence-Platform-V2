# Worker shutdown

The worker stops its periodic company-upload recovery sweep before closing any
shared dependency. A sweep already in progress is allowed to finish. It checks
the stop flag after database discovery and between queue insertions, so it does
not start additional insertions after shutdown. A committed upload that was not
enqueued remains discoverable by the next worker; the stable document-version
job ID preserves deduplication.

Recovery uses its own PostgreSQL connection pool with a server-enforced
10-second statement timeout and 5-second lock timeout. Its separate Redis
connection has a 10-second IORedis command timeout and one retry per request;
these limits do not change active-job connections. An IORedis command timeout
only rejects the local promise. It does not prove that Redis did not commit the
job. Only when an insertion fails ambiguously, shutdown awaits a PING on the
same recovery connection as an acknowledgement barrier. Idle recovery and
acknowledged insertions do not require that extra Redis operation. If the
barrier fails, shutdown retains the connection and reports failure rather than
disconnecting a possibly in-flight write. PostgreSQL remains authoritative: an unapproved
completed upload is discovered again after restart. Stable job IDs prevent
duplicates while a BullMQ job is retained; after completed-job removal, the
document processor's approved-version check makes a repeated job a no-op.

Shutdown then closes the BullMQ worker without force, closes all producer
queues, closes the health and metrics listeners, quits both Redis clients,
and disconnects both Prisma clients. The BullMQ worker must finish active jobs
while Redis and PostgreSQL remain available. Repeated signals join the same
shutdown run.

Each stage emits a fixed label, event, and elapsed milliseconds. A stage
deadline reports a stall; it does **not** cancel the underlying operation or
allow closure of a dependency that operation may still use. Rejections stop
the ordered sequence and set a nonzero process exit code without logging the
original exception. A timed-out operation that later completes allows the
remaining stages to run, but the final result remains failed.

PostgreSQL's server timeouts cancel discovery SQL and lock waits, but cannot
guarantee completion under a network partition. IORedis cannot safely cancel
an already-sent queue insertion; a failed acknowledgement barrier may still
hold shutdown. BullMQ's non-forced `Worker.close()` may wait for an active job
or main loop. Stage deadlines therefore provide bounded **detection**, not a
guarantee that every external failure exits within Docker's grace period. A
durable outbox or explicit per-version enqueue state would further improve
reconciliation under persistent network failure. Never force-close the worker
solely because a queue-count snapshot is empty.

An isolated Docker SIGTERM rehearsal confirmed the active-job limit: a job that
never settled exceeded the deliberately short test grace, and Docker ended the
container with exit code 137 (`OOMKilled=false`). After its BullMQ lease
expired, a restarted disposable worker completed that job once. This recovery
path does not make the original shutdown graceful, and the exact cause of the
earlier staging timeout remains unconfirmed.
