---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Layout planner no longer emits empty containers on named dashboards.

The prompt previously told the planner to lead with a "Health" container holding the four system tiles. Pulse has those tiles; named dashboards don't. On a dashboard, the planner would dutifully emit an empty Health container and the whole plan failed schema validation (`containers.0.tiles must have at least one entry`). The rule is now conditional on `CURRENT_LAYOUT` actually containing system tiles, with an explicit "never emit a container with zero tiles" rule up top.
