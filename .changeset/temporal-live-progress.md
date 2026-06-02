---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Live progress for v2 DAG nodes running on Temporal.

The node activity now heartbeats its full progress trail, and the dashboard-side
spawnNode polls the workflow and re-broadcasts new progress events through the
normal `onProgress` path — so `node_executions.progressJson` and the inbox
"thinking…" token stream update for Temporal runs, at ~1s granularity. Final
sub-second progress may be dropped; the run result is always captured.
