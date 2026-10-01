---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Boards (preview): Pulse and named dashboards as a canvas on a 12-column grid.

A board is a set of tiles placed on a 12-column grid and stored by the dashboard, not your browser. View Pulse as a board at `/boards/pulse` (agents you haven't placed sit in an Unplaced tray, grouped by recent use) and any named dashboard at `/boards/<id>` (laid out from its sections until you arrange it). Tiles never overlap and float up into gaps; on narrow screens a board becomes two columns, then one. Read-only in this release: editing and agents placing tiles come next. `/pulse` and `/dashboards/<id>` are unchanged.
