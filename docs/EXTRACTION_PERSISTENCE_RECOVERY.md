# Tender extraction persistence and recovery

The worker prepares extraction rows and validates citations before opening the
database transaction. It assigns UUIDs to documents, units, blocks, tables,
fields, and requirements so bulk inserts can retain their relationships without
round trips to fetch generated IDs. Each table is inserted in foreign-key order
using batches of at most 200 rows. Start and activation take the same
transaction-scoped advisory lock keyed by the tender version and recheck the
latest run under that lock. A late retry cannot activate after a newer attempt
starts. The extraction run becomes `COMPLETE` and its
tender version becomes active only in the same transaction, after all rows have
been written. A failure rolls back the inserts and activation together. No
schema migration is required.

The batch limit caps statement size; it does not split an extraction across
transactions. Keeping one transaction avoids exposing partial results or adding
a staging/cleanup state. CPU-heavy row preparation happens before the transaction
to reduce lock duration. The existing 120-second transaction timeout remains as
a bound. The worker's default 300-second extraction deadline covers parsing and
this transaction. Very large inputs may still exceed either deadline and must be
measured before changing those limits.

The API uses the extraction run ID as the BullMQ job ID. Replaying a queued run
attempts to enqueue that same ID, so a queue insertion failure after the database
commit can be recovered without creating a second run. Intentional retry of a
failed current-version run uses a new idempotency key and retains the failed run.
The existing permission and CSRF guards apply to the retry route.

The current tender version's latest extraction attempt drives the user-facing
extraction status. `activeExtractionRunId` continues to point only to a
completed authoritative extraction for downstream analysis. A failed latest
attempt therefore appears as failed without promoting its results.

## Disposable PostgreSQL verification

`tools/verify-extraction-postgres.mjs` calls the real built worker persistence
method and API extraction service against a disposable PostgreSQL 18 database
with all 18 repository migrations. It fails closed unless
`BIDVEDA_EXTRACTION_TEST_DATABASE_URL` names
`pr47_test@127.0.0.1:16432/bidveda_pr47_verification` without URL overrides.
Use only a dedicated container and volume; remove those exact resources after
the run. Build `@tender/api` and `@tender/worker` before running the script.
The synthetic documents are parsed data supplied directly to persistence; this
does not test PDF parsing, object storage, antivirus scanning, authenticated
HTTP, or frontend browser interactions.

In the isolated run on PostgreSQL 18.6, the representative fixture used four
documents, 29 units (24 primary pages, an 18-line BOQ sheet, three scanned
terms pages, and one technical page), 658 blocks, 658 requirements, 659
citations, one table, and 36 cells. Persistence used 17 bulk insert batches
with at most 200 rows each and 27 measured transaction operations. Three
repetitions took roughly 0.5–0.8 seconds inside the transaction on local
PostgreSQL; the controlled 50 ms delay per database operation took roughly
1.9–2.2 seconds.
All were below the unchanged 120-second transaction timeout. Five injected
insert/activation failures rolled back, preserving the prior active extraction
and risk pointer. Real connections also verified same-key and equivalent-source
start concurrency, queue-failure replay, retry, stale-worker rejection,
cancellation, and duplicate-worker activation protection.

These timings do not establish Neon latency or complete end-to-end parsing
time. The earlier approximately 1,388 sequential writes are a code-path
estimate; the new operation count is measured by the verification wrapper.
Before staging rollout, run a separately approved synthetic extraction through
the deployed API, worker, parser, and storage stack. Do not retry a real failed
tender as the first verification.

## Post-merge staging verification

1. Confirm the matching API and worker revisions, health, and migration status.
2. With approved synthetic documents in one staging organisation, start one
   multi-document extraction. Observe `QUEUED`, `PARSING`, `STRUCTURING`, and
   `COMPLETE` through the authorised API and UI.
3. Confirm the extraction quality counts, requirement citations, table cells,
   and active extraction pointer. Verify no other organisation can read them.
4. In a separate synthetic failed-run scenario, verify the Overview shows
   `Extraction failed`, the authorised retry creates one new run, repeated
   clicks do not create another run, and the historical failure remains visible.
5. Check that worker and API remain healthy. If any gate fails, retain the
   failed run and logs, stop further retries, and restore the prior matching
   API/worker images. This change has no migration to reverse.

Do not retry or modify a real failed tender as part of this verification.
