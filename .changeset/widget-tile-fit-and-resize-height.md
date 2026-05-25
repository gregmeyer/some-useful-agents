---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Widget tiles grow to fit their content, with a resize handle to pin height + scroll.

Tall output widgets used to get an internal scrollbar inside a capped tile. Now:

- **Tiles grow vertically by default.** A widget tile is as tall as its content
  (readable, no scrollbar); width stays the dashboard-defined grid column. New
  `outputWidget.tileFit` controls this per widget: `grow` (default) or `scroll`
  (cap height + scroll). The output-widget editor exposes the choice. The full
  run/agent detail view always renders at natural height regardless.
- **Resize handle pins a height.** Dragging a tile's resize handle in layout-edit
  mode now sets an explicit height, snapped to a short grid unit, and the tile
  body scrolls anything taller — so you can shorten a tall tile and it scrolls
  instead of growing. Width still snaps to dashboard columns. Persisted per tile
  in the existing layout localStorage.

Also: the dashboard CSS is served `no-cache` (was `max-age=300`) so style/layout
fixes land on refresh instead of being masked by a 5-minute stale cache — the
same trap that made an earlier tile change look broken until a hard reload.
