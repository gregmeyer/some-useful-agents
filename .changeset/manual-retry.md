---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

One-click manual retry on failed runs.

Failed runs (`status: failed`) gain a Retry button on the run-detail page. Clicking it recovers the original agent-level inputs from the prior run, creates a fresh run with `attempt: N+1`, and links back to the head of the chain via the new `retryOfRunId` field. Distinct from Replay (which re-runs from a specific node reusing upstream outputs); Retry redoes the whole run from scratch — the right tool for transient failures. Run-detail header now shows an "attempt N" badge on any retry, plus a "Retry of" link back to the original.

Schema additions: `runs.attempt INTEGER DEFAULT 1`, `runs.retry_of_run_id TEXT` (nullable). Migrations are additive — existing runs default to `attempt=1, retry_of_run_id=NULL`.

Foundation for upcoming auto-retry (agent-declared `retry:` policy), notify deferral, and triage surfaces.
