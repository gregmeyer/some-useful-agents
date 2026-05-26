---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: DAG canvas zoom + sticky Node execution header.

The DAG viewer on run detail now supports interactive zoom (wheel + drag-pan, plus a floating +/⧇/− toolbar in the bottom-right of the canvas) and renders the canvas a notch taller by default (380px standard, 240px for 1–2 node graphs) so labels and arrows read clearly without zooming.

The Node execution panel below the DAG now has a sticky header — title, search, and status filter stay pinned at the top of the viewport while the user scrolls through long node-card lists. The sticky DAG/Result bar above is released automatically (via a small scroll observer) the moment the Node execution section reaches the release line, so the two sticky surfaces don't fight for the top of the screen.
