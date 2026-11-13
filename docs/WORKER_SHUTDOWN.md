# Worker shutdown

The worker stops its periodic company-upload recovery sweep before closing any
shared dependency. A sweep already in progress is allowed to finish. It checks
the stop flag after database discovery and between queue insertions, so it does
not start additional insertions after shutdown. A committed upload that was not
enqueued remains discoverable by the next worker; the stable document-version
job ID preserves deduplication.

Shutdown then closes the BullMQ worker without force, closes both producer
queues, closes the health and metrics listeners, quits the shared Redis client,
and disconnects Prisma. The BullMQ worker must finish active jobs while Redis
and PostgreSQL remain available. Repeated signals join the same shutdown run.

Each stage emits a fixed label, event, and elapsed milliseconds. A stage
deadline reports a stall; it does **not** cancel the underlying operation or
allow closure of a dependency that operation may still use. Rejections stop
the ordered sequence and set a nonzero process exit code without logging the
original exception. A timed-out operation that later completes allows the
remaining stages to run, but the final result remains failed.

Prisma's query API does not provide a cancellation signal for the recovery
`findMany`, and BullMQ's non-forced `Worker.close()` may wait for an active job
or main loop. The stage deadlines therefore provide bounded **detection**, not
a guarantee that the process exits within Docker's grace period. Never shorten
the Docker grace period or force-close the worker solely because a queue-count
snapshot is empty. Investigate the first failed stage and its underlying
dependency before another staging maintenance attempt.
