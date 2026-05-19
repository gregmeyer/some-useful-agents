---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Allow system tiles (Pulse-synthetic widgets) in `LayoutPlan.containers.tiles`.

The schema's tile regex was `/^[a-z0-9][a-z0-9_-]*$/` — letter/digit first. But Pulse's system tiles (Runs Today, Failure Rate, Avg Duration, Agent Count) use a leading underscore by convention (`_system-runs-today`, etc.) to mark them as synthetic. When the layout-planner saw them in `CURRENT_LAYOUT` it correctly placed them in containers, but validation rejected the plan.

Tiles now match `/^_?[a-z0-9][a-z0-9_-]*$/` — the leading underscore is optional. The `topAgents.id` regex stays unchanged: that field is real agents only.

The layout-planner prompt was also updated to teach the LLM the new rule explicitly (and to include a system-tile container in its in-prompt example).
