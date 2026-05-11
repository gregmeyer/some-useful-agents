---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

dashboard: Build-from-goal wizard asks where to land the result

The wizard now opens with a target picker:
1. Just create the agent(s) (default — backwards-compatible)
2. Create agent(s) + a new dashboard
3. Add to an existing dashboard (with a dropdown of user dashboards)

The commit endpoint honors the choice: agents-only drops any planner-proposed dashboard, new-dashboard synthesizes one with the created agents if needed, and existing-dashboard appends the new agents to section 0 of the chosen user dashboard (pack-owned dashboards aren't selectable). On `/dashboards/:id`, the current dashboard is pre-selected as the target so you can iterate on it without picking again. Available on every surface that runs the wizard (/, /agents, /dashboards/:id).
