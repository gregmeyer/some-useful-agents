# Retrying failed runs

When a run fails — flaky API, transient network glitch, race condition — you have two ways to recover:

| Tool | When | Effect |
|---|---|---|
| **Retry** (this page) | The whole run failed; you want to redo it from scratch | Creates a new run with the same agent-level inputs, links back via `retryOfRunId`. Each retry is a fresh top-to-bottom execution. |
| **Replay from node** ([replay docs](../packages/dashboard/src/routes/run-mutations.ts)) | A specific node failed mid-DAG; upstream completed fine | Re-runs from a chosen node, reusing stored upstream outputs. |

Replay is for "node 4 broke; reuse the work from nodes 1–3." Retry is for "the whole thing failed transiently; just do it again."

## Manual retry (one click)

On any failed run's detail page (`/runs/:id`), the error block shows a **Retry run** button:

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠  Simulated failure        [Retry run]  [Suggest improvements] │
└──────────────────────────────────────────────────────────────┘
```

Clicking it:

1. Recovers the original agent-level inputs from the prior run's first node execution.
2. Creates a new run with `attempt: N+1` and `retryOfRunId` pointing at the head of the chain.
3. Redirects to the new run's page.

Only **failed** runs are retryable. Cancelled runs (deliberately stopped) and completed runs are not — use **Run now** for those.

## Retry chain semantics

The chain is **flat**: every retry points at the original run, not at the immediate previous attempt. This makes sibling counts cheap (`SELECT * FROM runs WHERE retry_of_run_id = ?`).

Each retry's `attempt` is the chain's `MAX(attempt) + 1`, so:

```
orig (attempt 1, failed)
  ↓ retry
attempt 2 (also failed)
  ↓ retry
attempt 3 (succeeded)
```

The run-detail page shows an **attempt N** badge in the header on any retry, plus a "Retry of: <run-id>" row in the metadata block linking back to the original.

## What does not get retried

- **`cancelled`** runs (a deliberate stop).
- **`completed`** runs (use Run now to re-execute with fresh inputs).
- The whole agent — only the run gets recreated; the agent definition isn't touched.

## API

```
POST /runs/:id/retry
```

Form body: `confirm_community_shell=yes` if the agent has community shell nodes (same gate as Run now).

Returns `303` redirect to the new run on success, or back to the prior run with a `?flash=` error message on failure (e.g. "Only failed runs can be retried").

## What's coming next

- **Auto-retry** ([plan](https://github.com/anthropics/some-useful-agents/issues)) — agents declare `retry: { attempts, backoff, delaySeconds, categories }` and the executor re-fires transient failures (timeouts, spawn failures) without paging anyone.
- **Notify deferral** — when auto-retry is in play, `failure` notifications wait until the final attempt fails.
- **Triage surface** — per-agent consecutive-failure tracking and a "now broken" view.
- **Scheduler backoff** — after N consecutive failed terminal attempts, the cron tick is skipped to stop spamming.
