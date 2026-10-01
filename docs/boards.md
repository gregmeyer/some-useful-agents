# Boards

> **Preview (0.29).** Boards are read-only for now: you can view Pulse and any named dashboard as a board at `/boards/<id>`. Editing (drag, resize, keyboard) and agents placing tiles arrive in the next releases. `/pulse` and `/dashboards/<id>` are unchanged until then.

A **board** is a canvas of tiles placed on a 12-column grid, stored by the dashboard rather than in your browser. Pulse is the board `pulse`; every named dashboard is a board with the dashboard's id (`user:morning-briefing`, `starter:weather`, …).

## What can be on a board

| Item | What it shows |
|---|---|
| `agent` | An agent's tile: its latest result drawn with its view, and a Run button. `fit: scroll` keeps a tall tile at its size and scrolls inside. |
| `heading` | A full-width section title. A dashboard's sections become headings. |
| `note` | A short note. `**bold**`, `*italic*` and `` `code` `` work; HTML is shown as text. |
| `system` | One of the Health tiles (runs today, failure rate, average duration, agents, scheduler). |

Every item has a position and size in grid cells: `x` (column, 0–11), `y` (row), `w` (columns, 1–12) and `h` (rows; one row is 40px).

## How tiles settle

Tiles never overlap and **float up into any gap**, so a board never has holes. Whoever saves a board (you, Improve layout, or an agent), the dashboard settles the tiles the same way: higher tiles first, then left to right; a tile that lands on another moves below it.

On narrow screens a board becomes two columns, then one, in board order (top to bottom, left to right).

## Pulse as a board

Until you place something, Pulse as a board has nothing placed and every agent sits in the **Unplaced** tray below, grouped as Pulse groups them today (Health, Recent, Idle, Never run). Placed tiles leave the tray; new agents always arrive in the tray, never in your layout.

## Named dashboards as boards

A dashboard you haven't arranged yet is shown laid out from its sections: each section becomes a heading followed by its tiles, left to right, wrapping at 12 columns. A tile's size comes from the dashboard's own size for it, then any Improve-layout hint, then the agent's preferred size:

| Size | Grid cells |
|---|---|
| 1x1 (default) | 3 columns × 5 rows |
| 2x1 | 6 × 5 |
| 1x2 | 3 × 10 |
| 2x2 | 6 × 10 |

An agent listed on a dashboard but not installed shows as a placeholder in its place.

## Reading a board

`GET /boards/<id>.json` returns the board (`items`, `version`, and `derived: true` when it hasn't been saved yet and is shown as laid out from Pulse or the dashboard's sections). For Pulse it also lists the `unplaced` agent ids.

Every save bumps `version`; a save made from an older version is refused rather than overwriting someone else's change, and the previous layout is kept so the last change can be undone.

## Related
- [Dashboard](dashboard.md) — Pulse and named dashboards today
- [A2UI views](a2ui-views.md) — how each tile is drawn
