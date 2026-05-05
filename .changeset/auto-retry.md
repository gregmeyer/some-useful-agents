---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Auto-retry on transient failures (R2 of failed-runs-and-retry plan).

Agents can declare a top-level `retry:` block. When a run fails with a configured `errorCategory`, the orchestrator sleeps with backoff and spawns a fresh attempt, linked back to the head of the chain via `retryOfRunId` (same shape as R1's manual retry).

```yaml
retry:
  attempts: 3                   # total tries including the first; default 1
  backoff: exponential          # exponential (default) | linear | fixed
  delaySeconds: 30              # base; 30 → 60 → 120 for exponential
  categories: [timeout, spawn_failure]   # default; conservative
```

`cancelled`, `setup`, `input_resolution`, `condition_not_met`, `flow_ended` are NEVER retried regardless of policy — they're deterministic or user-driven.

Implementation lives ABOVE the executor as a thin wrapper (`executeAgentWithRetry` in core/retry.ts). Callers — Run Now, manual retry, widget run, `sua workflow run` — switched from `executeAgentDag` to the wrapper. Replay route stays on the raw executor (replay is investigation, not auto-recovery). Agents without a `retry:` block fall through to a single executor call (zero overhead).
