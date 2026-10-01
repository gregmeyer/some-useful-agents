# Boards

> **Preview (0.29).** Open Pulse or any named dashboard as a board with **Board view** on its page (or go to `/boards/<id>`), and arrange it with **Edit**. Agents placing tiles arrive next. `/pulse` and `/dashboards/<id>` themselves are unchanged for now.

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

## Arranging a board

Press **Edit** (on a wide screen). Every tile gets a frame:

- **Move**: drag the tile. Dropping it on another tile's top row takes that spot and pushes the other tile down.
- **Resize**: drag the corner at the bottom right.
- **Keyboard**: Tab to a tile, then the arrow keys move it (up and down swap it with the tile above or below), Shift+arrows resize it, and Delete removes it.
- **Remove**: the × on the tile. On Pulse a removed tile goes back to the Unplaced tray.
- **Add**: type text and press **+ Heading** or **+ Note**. On a named dashboard, **+ Agent tile…** adds any agent that has a tile. On Pulse, **Place on board** on a tray tile puts it in the first free spot.

Nothing is saved until you press **Save**; **Cancel** throws the changes away. After a save, **Undo last save** puts the previous layout back (press it again to redo).

If the board was changed somewhere else since you opened it (another tab, or an agent), Save is refused rather than overwriting that change. Reload, then make your change again.

### Starting from your old Pulse arrangement

If this browser kept a custom arrangement for the old Pulse (your own groups or tile sizes), Pulse's board offers **Start from my Pulse arrangement** until the board is first saved. Each of your groups becomes a heading with its tiles, at the sizes you chose.

## Reading a board

`GET /boards/<id>.json` returns the board (`items`, `version`, and `derived: true` when it hasn't been saved yet and is shown as laid out from Pulse or the dashboard's sections). For Pulse it also lists the `unplaced` agent ids.

Saving is `POST /boards/<id>` with `{ "items": [...], "version": <the version you loaded> }`; it returns the saved board, `409` with the current `version` when the board changed since, or `400` with the reason when an item isn't valid. `POST /boards/<id>/undo` with `{ "version" }` puts the previous layout back. Every save bumps `version`.

## Related
- [Dashboard](dashboard.md) — Pulse and named dashboards today
- [A2UI views](a2ui-views.md) — how each tile is drawn
