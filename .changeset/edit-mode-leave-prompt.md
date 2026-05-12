---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: prompt before navigating away from edit mode

Adds a `beforeunload` guard while a layout surface (Pulse, Home, or
/dashboards/:id) is in edit mode, so accidentally closing the tab or
clicking a nav link mid-arrange triggers the browser's "leave site?"
dialog. Drag/resize/palette changes already persist to localStorage
instantly — this is purely a guardrail against losing your visual focus
while still in the middle of arranging tiles. Browsers ignore the
returned string and show their own generic dialog text.
