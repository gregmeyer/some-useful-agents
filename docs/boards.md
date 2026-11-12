# Boards

Pulse (`/pulse`) and every named dashboard (`/dashboards/<id>`) are **boards**. A board is drawn as a single A2UI surface, a canvas, so it can use any layout A2UI can express: titled sections, responsive grids of tiles, rows, tabs and cards. Every agent's tile is drawn inside the board by the agent's own view. The layout is stored by the dashboard, not your browser, so it's the same everywhere, and agents can arrange it too.

## Tiles

Each tile shows an agent's latest result, drawn with the agent's view (or its widget, converted), and keeps its controls:

- **Run** in the footer runs the agent in place and refreshes only that tile; **Run…** opens the agent page when it needs input first. An agent whose own view has a form or **Run again** runs from there instead, also in place.
- A tile can run another tile on the same board: a view's Run button or a table's row action may name an agent placed there (`context.agent`, or a Table's `rowAction.agent`), and that tile runs with the row's values and refreshes. Anywhere else, and for an agent not on the board, the action runs the view's own agent. See [a2ui-views.md](a2ui-views.md#what-a-view-can-bind-to).
- **⚙** configures the tile (template, title, size, accent).
- **×** on Pulse hides the agent from Pulse (restore it from the hidden section at the bottom). On a dashboard, remove a tile by arranging the board.
- A tile refreshes itself on the agent's `refresh` interval, and keeps its palette and accent.
- The few widgets A2UI can't draw yet (capture-image widgets, YouTube/Vimeo media) show a note pointing to the agent's page.

## Pulse

**Pulse opens on Today's edition** whenever a scheduled agent has finished a run in the last 24 hours. It is a front page made fresh each time you open it:

- a masthead with the date, and the day's headline (the first sentence of the agent that leads Home's brief);
- each scheduled agent's latest result, drawn as that agent's own view, with its **Run** button;
- **By the numbers**, a band under the headline when an agent has a count that changes from day to day: that count, its last days as columns (today's marked), and up to three other figures each over a line of its last days. The same figures as Home's brief; every number is read from an agent's output. The page's data carries them at `/board/figures` (the lead as a `Lead` stat with `days` for `DayBars`; `others/<n>` with `values` for a `Sparkline`). Every board's data carries its own agents' figures at the same paths, so a board you made can draw the same band (sua does it when you take a numbers suggestion, or ask for one).
- results with a table in the wide column; the others beside it (one with a number first, the number set large) and three abreast underneath.

Nobody arranges it and nothing about it is saved, so there is no Arrange here. `/pulse#agent-<id>` opens it at that agent's result; Home's reads and brief link that way. For a page like it that you can arrange, make a board and choose the front page under **How it looks**. See [ADR-0074](adr/0074-pulse-opens-on-a-generated-edition.md).

**All agents** (`/pulse/agents`), the second tab, is the board you arrange. It shows what you've placed first. Every other agent is under **Everything else**, in tabs by how recently you used it (Health, Recent, Idle, Never run); only the open tab is drawn, so a big Pulse stays quick. A placed agent you hide from Pulse drops off the board.

Until Pulse's board is first saved, it offers **Start from my Pulse arrangement** when your browser kept groups or tile sizes for the old Pulse: each of your groups becomes a section with its tiles at the sizes you chose.

## A board's goal

Every board you make can say what it's for, in a sentence, under its title: **Goal**, with **Edit** (or **Add a goal**).

- A board built from a request starts with that request as its goal ("from what you asked for"). Change it any time.
- sua is given the goal whenever it draws the board's page: after a build, from **How it looks → Let sua pick**, and when you ask it in words. Before, only the build knew what the board was for.
- The goal is kept apart from the layout: arranging, a new look and **Undo last save** don't touch it.
- Pulse and Today's edition have no goal; they aren't boards you make.

## Improve this board

**Improve this board**, in a board's toolbar, has sua review the board against its goal. Nothing changes until you press a suggestion's button.

1. **A goal first.** If the board has none, sua proposes one from its name and what's on it. Change the words if they're off, then **Use this goal**.
2. **Suggestions**, on the board under the goal, at most six:
   - **Add** an agent you already have that gives the board something it lacks. sua judges by what the agent returns (its output fields and latest result), not its name; two agents that return the same thing count as one.
   - **Leave out** a tile that repeats another, is failing, or doesn't serve the goal.

   - **Draw it**: content from what the board's agents already return, drawn on the board's own page. The day's headline from one agent's result; a "By the numbers" band (a figure that changes from day to day with its last days as columns, others with trend lines); the top item of an agent's list, linked; or a line of context. sua only suggests what the results can carry: no numbers band on a board whose agents have no figure that changes by day.

   Each has a one-line reason. **Skip** turns one down, and it isn't offered again for this board. **Apply all** takes every open one.
3. **What applying does**: for an agent added or left out, a new version of the board (**Undo last save** puts it back), the added agent runs once, and, when sua composed this board's page or it has none yet, sua redraws the page with the goal. A page you picked or arranged yourself is left as it is, with the new tile added in a section called Added. For content, sua redraws the board's page as something you asked for (so the page then counts as yours, and later additions leave it alone); the suggestion is marked **Drawn** once the page is saved.
4. **Look again** runs another round, knowing what you applied and skipped. When nothing would make the board better for its goal it says so, and its note says what none of your agents covers.

sua is shown the agents on the board and up to 25 of your others, the most related first. Each round is one model run. See [ADR-0075](adr/0075-boards-have-goals-and-sua-reviews-them.md).

## Dashboards

A dashboard you haven't arranged is shown laid out from its sections: each becomes a titled section holding a grid of its tiles, wide tiles spanning two columns. An agent listed on a dashboard but not installed shows as a note in its place.

**Save as pack** exports the board: each section (or tab) becomes a pack section, in reading order, with its tiles' sizes.

## Archiving a board

**Archive** (on a dashboard's toolbar) hides the board from the dashboards menu, the pickers and sua's suggestions. Nothing on it is deleted. Archived boards sit under **Archived** at the bottom of the dashboards menu; open one and press **Restore** to bring it back. Building or installing a board with the same id brings it back too. Pulse can't be archived.

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
| `AgentTile` | An agent's tile, its latest result drawn with its own view: `{ agentId, palette?, chrome? }` (`chrome: bare` on a composed page: no frame or header) |
| `SystemTile` | A health tile: `{ tileId }` (e.g. `_system-runs-today`) |

Agent views can't use these: they belong to boards. A board document is checked like a view (the A2UI processor in strict mode), with room for up to 800 components.

## A board's page

A board's document can be more than sections of tiles: composed like a front page from its agents' latest results, the way a [notebook's page](notebooks.md#layouts) is composed from the notebook's data ([ADR-0070](adr/0070-a-boards-page-is-a-layout-composed-from-its-agents-outputs.md)). The same document carries the notebook page's parts (`Panel` with its treatments and `hero`, `Columns`, `Callout`, `Lead`, `StatStrip`, `Table`…) bound to the board's data:

| Path | What it is |
|---|---|
| `/board/name`, `/board/date`, `/board/updated` | The board's name, today written out, how fresh the newest result is ("Updated 12m ago") |
| `/board/agents/<id>/outputs/<field>` | A field of the agent's latest result (its declared outputs, or what its last run printed) |
| `/board/agents/<id>/run/age`, `/status`, `/href`, `/running` | Its latest completed run, and whether a new one is going |
| `/board/agents/<id>/stats/<field>` | A numeric output as a `Lead` stat (`{ value, label, note, href }`) |
| `/board/agents/<id>/statItems`, `/board/statItems` | Its numbers (or every agent's) as `StatStrip` rows |

Any component may carry `when: "<agentId>"` (or `running:<agentId>`, `numbers:<agentId>`, each with `!` for not): it's drawn once the agent has a result, stays as a skeleton while a run of it is going, and a part bound to a field that came back empty goes. A part bound to an agent counts as placing it, like a tile. An `AgentTile` inside a Panel takes `chrome: bare` (the Panel titles it). The `front-page` preset fills a masthead, a lede (the agent with a headline, as a Callout), a story column beside a rail of numbers (a `Lead` over each tile) and a band of figures from the agents' output shapes. A composed page refetches its data on its tiles' shortest refresh and after a tile's Run, so bound parts stay current; the arranging operations and Undo work on it as on any board. Pulse stays a grid.

**Who composes it.** Once a board built from a request has run its tiles, the `board-page` agent reads what the board is for and what its agents' results hold (their fields and kinds, never their values) and keeps the grid, takes the front page, or composes a page that fits; a page that doesn't check out gets one more try, then the grid stays. When drafted agents are approved onto a board sua composed, it composes again with them. **How it looks**, a fold under the board's toolbar, offers the same by hand: Grid, Front page, Let sua pick, and "Made for this board" when sua composed it; each is saved as a new version (Undo last save puts the layout before it back). Asking sua from the board in words ("make it read like a newspaper", "lead with the weather") proposes a `board-page` card; Compose has the agent draw the page as asked. A page you picked or asked for is yours: sua doesn't compose it again on its own.

### API

- `GET /boards/<id>.json` returns the board, with `version` (and `derived: true` until it's first saved).
- `GET /boards/<id>/data.json` returns the canvas again (`messages`, including the board's data model, and the tile registry), for a composed page to take new data in place.
- `POST /boards/<id>/doc/apply` with `{ "doc", "ops" }` applies arranging operations to a working copy and returns the new `doc` and the redrawn surface; nothing is saved. The operations are `insert`, `move`, `remove`, `wrap`, `unwrap`, `set` and `span` (core `applyBoardOps`).
- `POST /boards/<id>/doc` with `{ "doc", "version" }` saves; `409` with the current `version` when the board changed since, `400` with the reason when the document isn't valid or adds an agent that isn't installed.
- `POST /boards/<id>/undo` with `{ "version" }` puts the previous layout back.
- `GET /boards/<id>` redirects to the board's page.

## Related
- [Dashboard](dashboard.md) — Pulse and named dashboards
- [A2UI views](a2ui-views.md) — how each tile is drawn

## Arranging a board by asking sua

From a board (or Pulse), ask sua in the drawer, e.g. "fix this dashboard so it doesn't duplicate everything" or "put the weather first and make the news tile wider". sua sees the board's outline and answers with an **Arrange <board>** card. The card lists each change in plain words (remove, move, add, resize, retitle) and the tile count before and after. **Apply** saves it as one new version of the board through the same path as ✎ Arrange, so you can undo it there. If the board changed after the card was made, Apply refuses and you ask again.
