---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Every Pulse tile can now be run from the board.

Pulse is used as a run console — on a real install 83% of all runs came from a
dashboard click, against 15% from the scheduler — but only tiles backed by an
`outputWidget` had a run control, because only those embed the widget's replay
button. Every `metric` / `status` / `text-headline` / `table` tile was a
read-only rectangle, and a tile whose agent had never run was a dead one showing
"No data yet" with nothing to do about it. On a 31-tile board, 8 were runnable.

Each tile now carries a **Run** button in its footer that re-runs the agent and
refreshes the tile in place. Tiles whose body already offers a run control keep
theirs, so nothing is doubled up; system metric tiles get none. An agent with a
required input and no default shows **Run…** linking to the agent page, rather
than a one-click button guaranteed to fail.

This reuses the existing in-place run path end to end — same
`form.wc-group--replay` markup, same `widget-replay.js.ts` handler, same
`/agents/:id/widget-run` → poll → `/pulse/tile/:id` swap — so it adds no client
JavaScript, and keeps working without JS by POSTing to `/agents/:id/run`.
