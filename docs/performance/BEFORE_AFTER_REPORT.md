# Deterministic request comparison

Measured on 2026-10-27 with Vitest, React Testing Library, synthetic API
fixtures, and `vi.advanceTimersByTimeAsync`. The same tests were run against
the committed `origin/main` source and the revised source in an isolated
worktree. Counts are invocations of the mocked frontend API client or mocked
`fetch`; no network request reached staging. The 20-second window starts
after five zero-time timer/microtask flushes, which settle the initial request
batch. These are request counts, not DOMContentLoaded, load-event, network-idle,
or user-visible ready-time measurements.

| Scenario                                             | Before | After |
| ---------------------------------------------------- | -----: | ----: |
| Stable Overview initial API calls                    |     17 |     9 |
| Stable Overview duplicate initial paths              |      8 |     0 |
| Stable Overview API calls during 20 idle seconds     |     36 |     0 |
| Active source-processing initial API calls           |     17 |     9 |
| Active source-processing API calls during 20 seconds |     76 |    44 |
| Dashboard plus shell initial calls                   |      7 |     4 |
| Dashboard plus shell duplicate initial paths         |      3 |     0 |
| Stable draft stage initial calls                     |      3 |     3 |
| Stable draft stage API calls during 20 idle seconds  |     12 |     0 |

The Overview fixture has one tender version, no source documents, and no
in-progress workflow. Its mock returns empty extraction, risk, assessment,
checklist, drafting, readiness, and package histories. The active fixture uses
the same responses with `workflowState.isInProgress=true`. The dashboard
fixture contains one synthetic organisation and an empty tender list. The
draft fixture contains one template, no generation runs, and no drafts.
Identical GETs were counted by exact normalized path; the dashboard test
asserts one request per shared path.

Run the focused measurement tests with:

```sh
pnpm --filter @tender/web exec vitest run src/components/tender-workspace.behaviour.test.tsx src/components/dashboard-request-efficiency.test.tsx src/components/draft-workspace.test.tsx src/lib/api.test.ts
```

The active draft test verifies that polling continues for a queued run and
stops after completion. The tender tests verify that automatic eligibility and
draft progression after CONTINUE still occurs, one pending support load queues
one follow-up cycle, focus refreshes stable data, and unmount clears timers.
Exact request totals after CONTINUE and across stage navigation were not
measured: those tests simulate specific transitions and mock mounted child
workspaces, so a single aggregate count would misrepresent browser traffic.
The pre-change full regression suite was not run as part of this comparison;
the revised source passed the full suite, including 154 web tests. These
results establish behavior coverage, not a before/after failure-rate metric.
Actual staging latency, 502 frequency, and deployed-browser request counts
require a separate controlled browser capture after review and deployment.
