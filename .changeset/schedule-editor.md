---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Schedule is now editable from the agent's Config tab — previously you had to hand-edit YAML to set or clear a cron expression. New card shows the current cron expression, a human-readable summary (`Every day at 8:00 AM`), and a Save button that validates server-side via the same `validateScheduleInterval` the scheduler uses. Empty input clears the schedule. Sub-minute (6-field) cron is still rejected unless `allowHighFrequency` is set on the agent.

Two latent bugs fixed along the way:

1. **`allowHighFrequency` was being silently dropped on every save**: `extractDag` didn't include it, so even agents that declared `allowHighFrequency: true` lost it on every `upsertAgent`/`createNewVersion`, breaking the scheduler's frequency-cap exception. Now persisted via `AgentVersionDag`.
2. **`updateAgentMeta` couldn't clear nullable fields**: it skipped any field whose value was `undefined`, conflating "key absent" with "key present, clear me." Switched the nullable fields (description, schedule, stateMaxBytes) to use `'key' in patch` so explicit-clear works.
