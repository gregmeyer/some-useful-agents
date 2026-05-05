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

## Auto-retry (agent-declared policy)

Agents can declare a `retry:` block to recover from transient failures without manual intervention:

```yaml
retry:
  attempts: 3              # total tries including the first; 1 = no retry
  backoff: exponential     # exponential | linear | fixed; default exponential
  delaySeconds: 30         # base delay; 30s → 60s → 120s for exponential
  categories:              # which errorCategory values trigger a retry
    - timeout
    - spawn_failure
```

When a run fails with a category in the policy's `categories:` list, the orchestrator sleeps with backoff and spawns a fresh attempt. Each attempt is its own `runs` row, linked back to the head via `retryOfRunId` — the same flat-chain shape as one-click manual retry. You'll see attempt 1, 2, 3 as siblings in the dashboard.

### Default categories

When `categories:` is omitted, the policy defaults to `[timeout, spawn_failure]` — flake-shaped failures only. Authors broaden by listing additional categories explicitly (e.g. `[timeout, spawn_failure, exit_nonzero]` for a flaky CLI).

### Categories that NEVER retry

These are deterministic (`setup`, `input_resolution`) or user-driven (`cancelled`) or already-skipped states (`condition_not_met`, `flow_ended`). Retrying changes nothing, so the orchestrator skips them regardless of policy.

### Backoff modes

| Mode | Formula | Example with `delaySeconds: 30` |
|---|---|---|
| `exponential` (default) | `delaySeconds × 2^(attempt-1)` | 30s → 60s → 120s → 240s |
| `linear` | `delaySeconds × attempt` | 30s → 60s → 90s → 120s |
| `fixed` | `delaySeconds` always | 30s → 30s → 30s |

All sleeps are capped at 1 hour.

### Auto-retry + manual retry interplay

Manual retry and auto-retry share the same chain. If a user clicks Retry on a run that's already part of an auto-retry chain, the new attempt picks up where the chain left off and counts further auto-retries against the policy's `attempts` budget. Manual retries can take you over the policy budget — they're explicit user overrides — but no further auto-retries fire after that point.

## What's coming next

- **Notify deferral** (R3) — when auto-retry is in play, `failure` notifications wait until the final attempt fails.
- **Triage surface** (R4) — per-agent consecutive-failure tracking and a "now broken" view.
- **Scheduler backoff** (R5) — after N consecutive failed terminal attempts, the cron tick is skipped to stop spamming.
