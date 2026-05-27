---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Promote Scheduled to a top-level nav entry.

The header now reads sua | Pulse | **Scheduled** | Agents | Settings |
Help. `/scheduled` previously lived as a sub-tab under Agents, which
made it hard to find — it carries cross-agent state (paused agents,
next-run timing) that doesn't fit the per-building-block grouping.
Dropping it from the Agents tab strip; promoting to global nav.
