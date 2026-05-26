---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dashboard run-display and Pulse-layout polish.

- Run detail no longer shows the literal "exit null" for DAG/multi-node runs
  (the run-level exit code is null by design); it shows a muted "—" instead.
- Node stdout strips a single enclosing Markdown code fence, so llm-prompt
  output wrapped in ```json … ``` renders clean instead of showing the backticks.
- Trivial graphs (1–2 nodes) use a compact DAG canvas instead of the full-height
  one, so single-node agents don't render a giant lone node in empty space.
- The Pulse grid sizes each tile to its own content instead of stretching every
  tile in a row to the tallest one, so short metric/status tiles no longer
  render as near-empty cards.
- Broken widget images cap their placeholder height so a failed hero image
  doesn't leave an oversized box.
- The named-dashboard header (`/dashboards/:id`) now mirrors Pulse: the dashboard
  name is the prominent heading with tile-count/source meta beside it, and the
  dashboards dropdown plus actions move into the right-aligned group.
