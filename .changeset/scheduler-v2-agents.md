---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Scheduler now fires v2 (DAG) agents — fixes silently-dropped wizard-built schedules.

Until now the scheduler daemon only loaded v1 YAML agents from disk: every v2 agent built via the dashboard wizard (or `sua workflow import`) was silently skipped at load time, even though the dashboard's Scheduled widget cheerfully listed them with "last: never" and a green "Scheduler running" dot. The split came from `loadAgents` skipping any file with `id:` + `nodes:` (the v2 marker), with no other code path picking them up.

`LocalScheduler` now accepts a parallel set of v2 agents plus a small dependency bundle, registers cron tasks for both v1 and v2 entries, and fires v2 agents directly through `executeAgentWithRetry` (the same path the dashboard's run-now and `sua workflow run` already use). The scheduler CLI now opens AgentStore + VariablesStore + EncryptedFileStore alongside the v1 loader and merges everything before starting.

Also: scheduler heartbeat now distinguishes `idle` (alive, zero agents registered) from `running` (alive, at least one agent registered). The dashboard widget surfaces this with an orange dot and the label "Scheduler idle (0 agents registered)" so future cases of "daemon happy, nothing firing" are visible at a glance instead of silently green.
