# Frontend request-efficiency audit

Base: `b455655860beade95363e5f4bb80279a73ad0689` on 2026-10-27.
This audit uses synthetic fixtures and local mocked requests. It does not measure
the deployed staging site.

## Confirmed causes

- `AppShell` and `Dashboard` each requested `/auth/session`,
  `/organisations`, and the selected organisation's tender list on the same
  dashboard mount. Both also need their own state, so the API client now shares
  only concurrent, ordinary GET promises for these three paths. It does not
  retain results after a request settles. Mutations and logout invalidate
  pending shared reads.
- `TenderWorkspace.loadWorkspace` refreshed support data on every five-second
  workspace poll. A separate support-data effect loaded the same data at mount,
  and a second five-second support interval ran during active work. The stable
  Overview fixture made 17 initial requests, including eight repeated paths,
  then 36 requests during 20 simulated idle seconds. One initial support load
  remains; workspace polling now runs only while workflow reconciliation is
  needed, and it does not start overlapping workspace reads.
- `DraftWorkspace` polled templates, generation runs, and drafts every five
  seconds even with no active run. It now polls only while a run is nonterminal.
  Explicit actions and focus/online refresh remain available.
- `TenderWorkspace.safeApi` converted every failed support request to
  `null`. It now treats HTTP 404 as absent data only for the current risk and
  eligibility endpoints, which can return 404 before those resources exist.
  Other failures are surfaced without replacing previously loaded support.

## Workflow constraints retained

The Overview uses the authoritative workspace response plus support data for
requirements, risks, eligibility counts, decisions, draft availability, and
review status. Support loading has sequential phases: histories run
concurrently, then current results, then decisions and detail requests. The
current-result and decision phases depend on IDs learned from earlier phases.
Deferring stage-specific history was not justified by the existing UI contract
and was left for a separate review.

Active source processing, risk analysis, assessment, checklist generation and
drafting still receive automatic refreshes. A CONTINUE decision explicitly
refreshes workspace and support. One support refresh may queue behind an
in-flight refresh; timer callbacks do not create unbounded concurrent cycles.
Workspace and dashboard updates use request tokens so late results cannot
overwrite a newer load. The tender page keys its workspace by organisation and
tender ID; organisation-specific sidebar and dashboard tender lists are cleared
or hidden while the new scope loads.

The reported Mumbai Vercel-region improvement is infrastructure work and is
not attributed to this change. The historical 80-network-request capture is
not used as an initial API-request count. Intermittent 502 investigation and
deployed-browser readiness timing remain separate.

## Follow-up correctness review (2026-10-28)

- Prisma and the draft backend include `INVALIDATED` among terminal generation
  states. Draft polling now stops for that state as it already did for complete,
  failed, and cancelled runs.
- A second support refresh could await a rejected in-flight load outside the
  owner's catch block. The waiter now observes the rejection safely, and the
  owner runs one queued retry while the same version remains current.
- An unsafe request invalidates pending shared reads. If a session or
  organisation read consequently fails with `STALE_RESPONSE`, AppShell now makes
  one fresh attempt. Other errors retain their existing handling.
- Workspace polling can discover a new tender version. It now clears old
  version support immediately, rejects late old-version results, and loads the
  new version's support once the previous load settles.
- Organisation creation dispatched a reload event and called Dashboard's load
  directly. The event alone now starts the immediate refresh.
