---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

dashboard: in-place "+ Add tile" modal on /dashboards/:id

When a user dashboard is in Edit Layout mode, each section grows a "+ Add tile" button next to its title. Clicking it opens a searchable picker: a "Suggested" row ranked by last-fired recency, then the full grid of signal-bearing agents. Picking one POSTs to the existing tile-append route with returnTo=live and lands back on the live dashboard. Empty sections now render in edit mode so users can fill them in place without bouncing to /edit.
