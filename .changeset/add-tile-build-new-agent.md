---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

dashboard: add-tile modal offers two paths to create a new agent

The add-tile modal on /dashboards/:id now ends with a footer that
exposes both paths: **+ Blank agent** (links to /agents/new) and
**Build from goal** (opens the existing AI wizard). Picking
"Build from goal" closes the add-tile modal and opens the goal
wizard on top — the dashboard view now renders the wizard's modal
(it was previously only on /agents and /).
