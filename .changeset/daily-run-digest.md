---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Daily run digest in the inbox — know at a glance whether your agents ran.

Failures already open an inbox thread, but successful runs had no inbox surface,
so a day of green runs was invisible in the review queue. SUA now posts one
low-priority `cadence` thread each morning summarizing the previous day's runs:
a counts header (`12 runs · 10 ok · 2 failed · 5 agents`) plus one line per
agent — a clean one-line summary for successes, and a link to the existing
run-failure thread for failures (never restating the error). The summary parses
structured output (a final JSON object's `headline` / `summary` / `label:value`)
instead of dumping raw JSON, and internal system agents (inbox-triage, …) are
excluded so it's about your own agents. Empty days are skipped; exactly one
thread per day (restart-safe, catches up the previous day after downtime). It's the first real `cadence` producer, runs in-process in the
dashboard, and is default-on (`SUA_DAILY_DIGEST=0` to opt out).

Also adds optional `since` / `until` (ISO `startedAt` bounds) to
`RunStore.queryRuns` for correct time-window queries.
