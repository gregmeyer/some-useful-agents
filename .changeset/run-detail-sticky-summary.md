---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Run detail: sticky DAG + result summary while scrolling node logs.

The DAG visualization and result widget at the top of `/runs/:id` now stick to the viewport (capped at 60vh) while the node-execution panel scrolls below. On long runs with many nodes you keep the graph and final output in view instead of having to scroll back up. Falls back to a non-sticky stacked layout below 900px wide.
