---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage now knows your dashboards.

The triage turn is handed a `DASHBOARDS` catalog — your existing dashboards as
`[{id,name,tiles,agents}]` — so it can answer "which dashboards do I have / where
can I add agents", target an existing dashboard by its exact id when pinning an
agent's tile (`dashboard-editor` add-tile) instead of guessing a name and minting
a near-duplicate, and skip re-adding an agent that's already pinned.
