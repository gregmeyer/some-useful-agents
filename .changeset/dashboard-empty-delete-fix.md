---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix the "delete empty dashboard?" prompt not appearing after removing the last tile. The trigger is now server-driven: the dashboard route reads the `?emptyDashboard=1` redirect flag, confirms the dashboard is user-owned and genuinely has zero tiles, and renders `data-offer-delete="1"` on the host element. The client reads that attribute directly instead of re-parsing `window.location.search` (more reliable), and the check runs before the layout/drag setup so it fires even if that machinery hiccups on an empty dashboard. Verified end-to-end against a running daemon.
