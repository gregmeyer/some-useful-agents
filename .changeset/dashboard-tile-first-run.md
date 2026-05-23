---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Run an agent once when it's first added to a dashboard, so its tile renders in place.

A tile shows nothing until its agent has produced output, so adding a never-run
agent to a dashboard left a blank card until the next scheduled or manual run.
Adding a tile now fires one fire-and-forget courtesy run when the agent has no
prior run, so the tile populates on the next render. Skipped for agents that
already have a run (no redundant work when re-added or shared across dashboards)
and for community shell agents that require explicit audit confirmation.
