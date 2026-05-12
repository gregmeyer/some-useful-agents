---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: clear edit-mode flag on pagehide

Followup to #258. Edit mode persisted across navigations (from #242)
so returning to a layout surface re-entered edit mode unexpectedly.
`pagehide` now clears the flag — edit mode still survives drags
within a page session, but resets when you actually leave.
