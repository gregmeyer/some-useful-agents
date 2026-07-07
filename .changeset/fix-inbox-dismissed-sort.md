---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix column sorting on the inbox archive view (`?status=dismissed` / `resolved`).

The sort-header links on the dismissed/resolved archive dropped the `status`
param, so clicking a column header bounced the operator back to the active
inbox instead of re-sorting the archive in place. The header builder now
preserves `status`, matching the store (which already sorted correctly).
