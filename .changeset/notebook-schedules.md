---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's schedule now runs its pipeline.

A notebook with a schedule ("every morning") runs its searches when due, from the dashboard, the same as pressing Run. Each due time runs once; after downtime it catches up with one run; a new or changed schedule waits for its next time; a busy pipeline is retried next minute. The header says when it runs next (or that it needs a search first), and scheduled passes are marked "on schedule" in How it was made. `SUA_NOTEBOOK_SCHEDULES=0` turns it off. See ADR-0050.
