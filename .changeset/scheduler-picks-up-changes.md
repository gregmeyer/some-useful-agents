---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

The scheduler picks up schedule changes, and edits to scheduled agents, without a restart.

`sua schedule start` reads the agents again every 30 seconds and brings its timers up to date: a new or changed schedule takes effect, an agent unscheduled, paused or removed stops, and one you edited runs as it is now (a scheduled run used the agent as it was when the scheduler started). sua no longer tells you to restart the scheduler after changing a schedule, and the dashboard's schedule messages say it takes effect within a minute.
