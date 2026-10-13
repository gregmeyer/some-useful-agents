---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agent views can chart earlier runs, and a Run button in a view runs its agent.

A view's `/history` was always empty: no page passed earlier runs in. Now the run page, board tiles, the inbox and chat all do, and every numeric output is also a ready-made series at `/series/<name>` (oldest first, ending with this run, up to 30 points), so a `Sparkline` can bind `values: { path: /series/stars }`. Earlier runs are only read when a view uses them. `/agent/id` and `/agent/name` name the view's agent. A `Button` with a `run-agent` action runs the view's own agent (in place on a tile, otherwise it opens the run); the target is always the view's agent, so a view can't start a different one.
