---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Widgets are drawn with A2UI by default.

Pulse tiles, dashboards, run results and inbox widgets now draw agents' existing widgets with the A2UI renderer (the same values; sort/filter/paging, tabs and run-in-place forms work in the browser). If a widget looks wrong, Settings → Appearance → Widget renderer switches back to the previous renderer; that fallback stays for one release and is then removed. Widgets with a capture-image control keep the previous renderer; the copy control works on A2UI widgets.
