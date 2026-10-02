---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Arrange canvas boards: an outline editor for sections, tabs, rows, grids and tiles.

On a board's canvas page, **✎ Arrange** opens an outline of the board beside it. Add sections, headings, notes, grids, rows, tabs, cards and tiles; wrap things in sections, cards, rows or tabs (or unwrap them); move by dragging in the outline or Alt+arrows; set titles, text, grid width, palettes and how many columns and rows a tile takes; undo step by step, then save. Every change is applied by the dashboard with one set of tree operations (`applyBoardOps` in core, the same ones agents use through `board-place`), so a canvas can't be saved broken, and a stale save is refused.
