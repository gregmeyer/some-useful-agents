---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Tile removal on a named dashboard now (1) shows a confirm dialog before deleting and (2) keeps the user on the dashboard view afterward instead of bouncing them to `/dashboards/<id>/edit`. The X button in the dashboard view passes `returnTo=dashboard` to the delete route; the edit-sections page's existing flow (which legitimately wants to land on /edit) is unchanged.
