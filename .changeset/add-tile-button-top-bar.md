---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: + Add tile moves to the top action bar (was being DOM-wiped)

The previous per-section + Add tile buttons were rendered server-side
inside #dashboard-containers, but widget-layout.js.ts wipes that host
on load and re-renders sections from a client-side layout. So the
buttons disappeared the moment the page hydrated.

Move to a single + Add tile primary button in the top action bar
alongside Edit layout / Edit sections / Save as pack. Modal still
posts to section 0 (server-side section structure isn't visible in
the live view anyway).
