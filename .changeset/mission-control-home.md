---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Unify the dashboard front door: one Mission Control home.

The root `/` was a stripped-down Pulse (system stat tiles only) duplicating
`/pulse`, while the inbox — the most powerful surface — was a quiet nav link with
no presence. There's now ONE dashboard surface at `/`: a "Needs you" strip of
inbox threads awaiting your reply on top, the live, fully-editable Pulse board
(system + agent signal tiles, with the dashboards dropdown to switch to named
dashboards) in the middle, and a collapsed recent-activity feed at the bottom.
`/pulse` 302-redirects to `/` (its sub-routes — tile fragments, hide/show-all,
layout planner — are unchanged); the nav renames **Pulse → Home**. A global
Inbox badge (count from the new `/inbox/needs-you-count`) shows on every page.
New core inbox queries `countNeedsYou` / `listNeedsYou` back the badge and
preview.
