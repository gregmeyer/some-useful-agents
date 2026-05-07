---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Loop nodes now emit per-iteration progress events.

When a parent agent uses `loop` to fan out across N items, the dashboard previously rendered the loop as a single black box that read "running" for the entire fan-out — users had to dig into nested sub-run pages by URL to see whether iteration 3 of 8 was alive, dead, or just slow.

Loop nodes now create a `running` node-execution row up front and emit two `SpawnProgress` events per iteration (`loop_iteration_start` / `loop_iteration_complete`) into the existing `progressJson` channel. The dashboard's run-detail progress indicator already reads that channel, so messages like `iteration 3/4: rula done` and `iteration 1/4: ashby failed — <error>` show up inline at the parent run without further dashboard work.

Failed iterations also surface their sub-run error in the message, so partial-failure debugging no longer requires URL-walking into nested runs.
