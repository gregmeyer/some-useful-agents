---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Dashboard nav: Pulse-first top bar with in-page Agents section tabs.

The top navigation is now `sua · Pulse · Agents · Settings · Help`, with Pulse
promoted to the first nav item. The building blocks and executions —
Agents, Tools, Nodes, Runs, Packs — are grouped under **Agents** and surfaced as
an in-page tab strip on each of those landing pages, mirroring the Settings
shell (no separate global subnav bar). The top-level "Agents" item links to the
agents list and stays active across the whole section. URLs are unchanged; this
is purely an information-architecture grouping so the daily-driver surfaces
(Pulse, then your agents) lead, and the supporting pages stay one click away
without crowding the top bar.

On Pulse, the dashboard selector dropdown moves from above the page title to the
right side of the header row, so it no longer sits on top of the "Pulse" heading.
