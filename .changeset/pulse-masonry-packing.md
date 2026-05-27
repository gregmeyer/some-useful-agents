---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pulse + dashboards: masonry-style packing eliminates grid voids.

The 4-column Pulse grid used to lock every row's height to its tallest
tile (with `align-items: start`), turning the space below shorter tiles
into voids that belonged to the short tile's own grid cell —
undrop-targetable, unfillable, visually ugly. Dragging a tile into a
visual gap would either rearrange the layout or reject the drop.

The grid now declares `grid-auto-rows: 8px` + `grid-auto-flow: dense`,
and a small JS module (`pulse-masonry.js.ts`) computes `grid-row: span N`
per tile from its rendered height. A 200px tile takes ~9 row-units, an
1115px tile takes ~48. Columns pack independently (Pinterest-style),
no voids. ResizeObserver re-packs on content height changes (image
load, widget body swap, manual resize). MutationObserver re-packs when
tiles are added/removed via drag-drop or planner Apply. Window resize
also triggers a re-pack.

`.pulse-tile--1x2` and `.pulse-tile--2x2` no longer declare
`grid-row: span 2` — the row-span is computed. Their `max-height: 600px`
cap is preserved so the planner's wide-and-tall intent still means a
ceiling on height. Applies to named-dashboard `.pulse-grid` instances
too — same packer, same triggers.
