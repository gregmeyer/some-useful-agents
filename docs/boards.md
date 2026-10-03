# Boards

Pulse (`/pulse`) and every named dashboard (`/dashboards/<id>`) are **boards**. A board is drawn as a single A2UI surface, a canvas, so it can use any layout A2UI can express: titled sections, responsive grids of tiles, rows, tabs and cards. Every agent's tile is drawn inside the board by the agent's own view. The layout is stored by the dashboard, not your browser, so it's the same everywhere, and agents can arrange it too.

The previous layout is one switch away for this release: Settings → Appearance → **Show Pulse and dashboards as boards**. With it off, `/boards/<id>/canvas` still shows a board's canvas.

## Tiles

Each tile shows an agent's latest result, drawn with the agent's view (or its widget, converted), and keeps its controls:

- **Run** in the footer runs the agent in place and refreshes only that tile; **Run…** opens the agent page when it needs input first. An agent whose own view has a form or **Run again** runs from there instead, also in place.
- **⚙** configures the tile (template, title, size, accent).
- **×** on Pulse hides the agent from Pulse (restore it from the hidden section at the bottom). On a dashboard, remove a tile by arranging the board.
- A tile refreshes itself on the agent's `refresh` interval, and keeps its palette and accent.
- The few widgets A2UI can't draw yet (capture-image widgets, YouTube/Vimeo media) show a note pointing to the agent's page.

## Pulse

Pulse shows what you've placed first. Every other agent is under **Everything else**, in tabs by how recently you used it (Health, Recent, Idle, Never run); only the open tab is drawn, so a big Pulse stays quick. A placed agent you hide from Pulse drops off the board.

Until Pulse's board is first saved, it offers **Start from my Pulse arrangement** when your browser kept groups or tile sizes for the old Pulse: each of your groups becomes a section with its tiles at the sizes you chose.

## Dashboards

A dashboard you haven't arranged is shown laid out from its sections: each becomes a titled section holding a grid of its tiles, wide tiles spanning two columns. An agent listed on a dashboard but not installed shows as a note in its place.

**Save as pack** exports the board: each section (or tab) becomes a pack section, in reading order, with its tiles' sizes.

## Build a board from a request

Ask for one any of three ways:

- **＋ New board** on Pulse or any dashboard;
- **Ask sua** ("build me a board for my evenings: top Hacker News, tomorrow's weather and a cocktail idea"); the inbox triage agent starts the build and links the board;
- **MCP**: `build-board` (with `board-build-status` to follow it) from Claude Desktop, Codex or any MCP client. The build runs in the dashboard, which picks it up within seconds.

You describe what the board should show, in your words, e.g. *"A morning board: the weather in Seattle, how the markets are doing, top Hacker News stories, and new remote PM job leads"*. Then sua:

1. **Picks agents** you already have that answer it (the **board-builder** agent reads your agents' titles, descriptions and example questions; it never invents agents), groups them into sections and sizes them;
2. **lays out** a new board with them (the same operations as Arrange);
3. **runs every tile once**, so the board opens with results;
4. **tells you in your inbox** when it's ready: what it shows, any tile that didn't run cleanly, and the parts of your request **no agent covers yet**;
5. **drafts an agent for each uncovered part** (Build from goal's drafter and critic), saved as a *draft*: you can open it on the Agents page, but nothing runs it;
6. **asks once**, in your inbox (and on the board), to approve them. **Approve** makes them active, adds them to the board in a **New agents** section and runs them; **Decline** deletes the drafts.

You're taken to the new board straight away; it shows progress while it builds, and you can leave. The board is an ordinary dashboard afterwards: arrange it, rename it, or delete it. If the dashboard restarts mid-build, the inbox says so.

New agents never run before you approve them. If some tiles didn't run cleanly, the board's banner offers to **run them again**. A draft that can't be made (the critic gives up, or it would reuse an existing agent's id) is listed in the approval message instead.

## Arranging a board

Press **✎ Arrange** on Pulse or a dashboard (on a wide screen). An outline of the board appears on the left; pick something there, or click a tile or a section title on the board.

- **+ Add** a section, grid, row, tabs, card, heading, note or health tile; **+ Agent tile** any agent with a tile. The agent list searches by name, id or what the agent does, starts on the agents not yet on this board (**All** and **On this board** are a click away), and shows 20 at a time. New things go *into* the selection when it holds things (a section, grid, row, tabs, card), otherwise just after it.
- **Wrap in…** puts the selection inside a section, card, row, column or tabs (tabs turn a section into a tab you can add others beside). **Unwrap** puts a container's contents back where it was.
- **Move**: drag in the outline (onto a container to move into it, onto anything else to move before it), or Alt+↑/↓ to move within its parent.
- **Settings** for the selection sit under the outline: a section's title, a heading's or note's text, a grid's tile width, tab titles, and a tile's palette and how many columns and rows it takes in its grid.
- **Remove** (or Delete in the outline) takes out the selection and everything in it.
- **↶ Undo** steps back through your changes; nothing is saved until **Save**. **Undo last save** puts the previous saved layout back; **Cancel** throws your changes away.

Every change is applied by the dashboard with the same rules agents use, so the board can't end up broken: a change that wouldn't make sense (moving a section into itself, adding an agent that isn't installed) is refused with the reason, and a save from a stale copy of the board is refused rather than overwriting a newer layout.

## Suggest a layout

**✨ Suggest a layout** asks how you want the board arranged ("what needs attention first", "group by topic", or your own words), then has the layout planner arrange it that way. Leave the box empty for its best guess. Its suggestion opens in Arrange mode as unsaved changes, with the planner's summary above the board: adjust it, then **Save**, or **Cancel** to keep the board as it was.

## Agents and MCP clients

An agent can arrange a board with the built-in [`board-read` and `board-place`](tools/board-place.md) tools, and MCP clients (Claude Desktop, Codex…) get the same two tools from `sua mcp`. Their changes land as a new version you can undo from the board page, and follow your [tool policy](tool-policies.md), where the board id is the resource. They work on the board's tree with the same operations as **✎ Arrange** (`insert`, `move`, `remove`, `wrap`, `unwrap`, `set`, `span`), so an agent can, say, put the weather tile in a new "Outside" section two columns wide, or turn two sections into tabs.

## The board document

A canvas is an A2UI document (`components`, one with id `root`) using the basic catalog plus five board-only components:

| Component | What it is |
|---|---|
| `Section` | A titled group: `{ title, child }` |
| `Grid` | Tiles in responsive columns, each at least `minWidth` px (default 280): `{ children, minWidth? }` |
| `Cell` | A grid child spanning columns and/or rows: `{ child, span?, rows? }` (1–4) |
| `AgentTile` | An agent's tile, its latest result drawn with its own view: `{ agentId, palette? }` |
| `SystemTile` | A health tile: `{ tileId }` (e.g. `_system-runs-today`) |

Agent views can't use these: they belong to boards. A board document is checked like a view (the A2UI processor in strict mode), with room for up to 800 components.

### API

- `GET /boards/<id>.json` returns the board, with `version` (and `derived: true` until it's first saved).
- `POST /boards/<id>/doc/apply` with `{ "doc", "ops" }` applies arranging operations to a working copy and returns the new `doc` and the redrawn surface; nothing is saved. The operations are `insert`, `move`, `remove`, `wrap`, `unwrap`, `set` and `span` (core `applyBoardOps`).
- `POST /boards/<id>/doc` with `{ "doc", "version" }` saves; `409` with the current `version` when the board changed since, `400` with the reason when the document isn't valid or adds an agent that isn't installed.
- `POST /boards/<id>/undo` with `{ "version" }` puts the previous layout back.
- `GET /boards/<id>` redirects to the board's page.

## Related
- [Dashboard](dashboard.md) — Pulse and named dashboards
- [A2UI views](a2ui-views.md) — how each tile is drawn
