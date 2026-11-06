---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A board's page can be composed from its agents' results, like a notebook's page.

A board's document can now carry the notebook page's parts (Panel treatments, Columns, Lead, Callout, StatStrip…) bound to a board data model under `/board/...`: the board's name and date, and per agent its latest result's fields, its run, and its numbers. Parts carry `when: <agentId>` so they're drawn once the agent has run, stay as skeletons while it runs, and take new data in place as the agents rerun. A `front-page` preset fills a masthead, a lede, a story column beside a rail of numbers and a band of figures from the agents' output shapes. `AgentTile` takes `chrome: bare` inside a Panel. The notebook's layout resolver is now a generic one (`resolveLayout`), with the notebook's behaviour unchanged. Existing boards (grids of tiles) draw exactly as before. ADR-0070.
