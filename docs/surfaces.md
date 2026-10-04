# Surfaces and items

sua's Home and each [notebook](notebooks.md) (and later boards and canvases in a conversation) is moving to **goal surfaces**: what you see is chosen by a goal and rules you can change, not fixed per page. The design is [ADR-0049](adr/0049-goal-surfaces.md). It has three layers that never mix:

1. **Items**: what is true. Typed objects read from what sua already stores. *(Shipped: the item index, below.)*
2. **Surfaces**: what is emphasized now. A versioned document per surface holds a goal, rules and your pins, and every change records who made it and why. *(Shipped: the surface model, below.)*
3. **Presentation**: a renderer turns a surface plus its items into the page. *(Shipped for Home: its **Today** tab, below.)*

## Items

An item is one thing that needs you or matters now. Each has:

- **a stable id**, so a surface can pin or rank it and find it again:

  | Id | What it is | Kind |
  |---|---|---|
  | `thread:<id>` | a conversation waiting on you: a card to approve, a question to answer, a failure | decision / question / alert |
  | `question:<id>` | a run stopped to ask you something (ask-a-person) | question |
  | `agent:<id>:failing` | an agent whose latest finished run failed; `value` = failures in a row (3+ is urgent) | alert |
  | `agent:<id>:outcome` | an agent whose latest run finished but missed the outcome it declared | alert |
  | `agent:<id>:draft` | a draft agent waiting to be made active | decision |
  | `board-build:<id>` | a board being built, or a build that failed in the last day | progress / alert |
  | `system:scheduler` | the scheduler: a problem when agents are scheduled and it isn't running | status |

- **urgency** (critical, high, normal, low) and **state** (open: waiting on you; in-progress; waiting; ok: healthy, shown for context).
- **subject**: the agent, run, thread, board or question it's about.
- **actions** it supports, typed: approve or skip a card, reply in the thread, answer a question, run an agent again, make a draft active, open a page. The store that owns the truth carries them out.
- **evidence** (the runs, outcome or build behind it) and **provenance**: which store it came from, what produced it, and when.

One fact is one item. A conversation that mirrors something else becomes that item's **Ask sua** / **Open the thread** action rather than a second item, for example a run-failure thread for a failing agent, or the inbox copy of a run's question. Archived agents produce no items.

Items are sorted most urgent first, then things waiting on you, then newest.

### Reading items

- **Dashboard:** `GET /api/items`, which needs a signed-in session. Query parameters: `kind` (repeat it or separate with commas), `agent`, `ok=0` to leave out healthy context items, and `limit` (1–200). It returns `{ items, generatedAt }`.
- **MCP:** the `items-read` tool takes `kind[]`, `agent`, `includeOk`, `limit`, and `format`. Text output is one line per item (`[urgency] kind · title — summary (id; actions)`); `json` returns the full items.
- **Code:** `collectItems(itemSourcesFromHandle(db, agentStore, runStore, dataDir), query)` from `@some-useful-agents/core`. The per-source rules are pure functions in `packages/core/src/items/projections.ts`. Home's inbox list uses the same rule (`threadAttention`) to decide what a thread is waiting on.

## Surfaces

A surface document (`packages/core/src/surfaces/`) holds:

- **goal**: one line, e.g. "only things that could change what I do today".
- **regions**: named places that stay where they are unless you move them (stable anchors). Home starts with **Needs you** (open items), **Happening now** (in progress or waiting) and **All good** (healthy context). An item lands in the first region whose match fits.
- **rules**, evaluated against items, newest first: the rule you made last wins over older ones. Each matches on kind, urgency, state, source, agent, or item id or prefix.
  - `hide` leaves matching items out.
  - `filter` shows only matching items in a region.
  - `promote` puts them first.
  - `group` groups them by kind, agent or source.
  - `collapse` keeps them folded.
  - `represent` draws them with a given primitive (row, card, metric, status, alert, timeline, table, evidence).
- **overrides**, your meaning for single items:
  - `pin` keeps an item at the top, optionally of another region;
  - `rank` gives it a position;
  - `group` gathers items under your label;
  - `hide`, `expand` and `collapse` do what they say.

Every rule and override records who added it and when.

### One way to change it

`applySurfaceOps(doc, ops, actor)` is the only way a surface changes. Gestures, sua and agents all send the same ops: `setGoal`, `addRule`, `removeRule`, `pin`, `unpin`, `rank`, `group`, `ungroup`, `hide`, `show`, `expand`, `collapse`, `represent`, and the structural `addRegion`, `removeRegion`, `moveRegion` and `renameRegion`. The result is validated.

The actor is `user` (you, directly), `user-conversation` (you, by applying sua's preview), `agent:<id>`, or `system`. An agent or the system can change things within regions, with its name on the change. **Changes to the regions themselves wait for your approval**, so the page never rearranges itself under you.

`SurfaceStore` keeps every version along with its ops, actor and reason. `apply(…, { expectedVersion })` refuses a change made against an older version. `restore(id, version)` undoes by writing the earlier document as a new version. Before the first change, a surface is its default (version 0).

### What it compiles to

`compileSurface(doc, items)` returns each region's entries in order, with **reasons**. It is deterministic.

- **Order within a region:** your pins, then your ranks, then promote rules, then the items' own order (most urgent first). Regions only move when an op moves them.
- **Reasons** say why each entry is where it is: "Pinned by you, Oct 3", "First because: approvals first (by you, through sua, Oct 3)", "Grouped by news", "Folded by …".
- **Each entry** also carries its group, whether it's collapsed, and the primitive to draw.
- **Left-out items** are listed with why ("Hidden by the rule …", "Not shown in Needs you: …").
- **Region limits** count the overflow as "N more". Pins are never cut.

## Home's Today tab

Home's first tab, **Today**, in Home itself and in the sua drawer, is Home's surface drawn. Under the description, a goal line says what Home is arranged for, and whether by the defaults or by your rules (with the version).

- **Needs you** and **Happening now** show their items as rows, in the compiled order.
  - A conversation opens as a conversation.
  - Any other item (a failing agent, a missed outcome, a draft, a board build) opens a pane beside the list. The pane shows what it is, the evidence (the runs behind it), what you can do, and **why it's here**.
- **Actions work in place.** **Run it again** starts a run and links to it. **Make it active** activates a draft. **Ask sua to fix it** opens a conversation about the agent. The list refreshes afterwards, so a handled item moves or goes.
- **All good** items, like the scheduler when it's fine, are one quiet line at the bottom.
- **Folded groups** (by default, your draft agents) are one line you can open: "43 draft agents waiting to be made active".
- **Searching or filtering** lists matching conversations, as the tab did before.

Home's defaults are version 0 of its surface: three regions, plus three rules marked "by default":
- questions and approvals first;
- draft agents grouped together;
- drafts folded.

### Changing Today by hand

Each row on Today has a **⋯** menu, which shows when you point at the row:
- **Pin to top** (and **Unpin**);
- **Move up** and **Move down**;
- **Hide from Home**.

You can also **drag** a row within its region. Each change is saved as your change to Home's surface (`POST /surfaces/home/ops`, actor `user`), so the reason under an item says "Pinned by you, Oct 4".

After a change, a bar at the bottom of the list offers:
- **Undo** (`POST /surfaces/home/restore`), which restores the version before your change;
- when there's a clear one, **the rule that does the same for everything like it**. For example, pinning a failing agent offers "Always put failing agents first?". **Make it a rule** adds the rule, and a rule you make goes ahead of older ones.

Hiding one conversation never offers to hide all conversations of its kind. Hide suggestions are only for things agents make: everything from one agent, drafts, board builds.

Hidden items are listed at the end of Today ("2 hidden from Home"), each with the way back: **Show** if you hid it, or **Stop this rule** if a rule hid it.

### Asking sua to change Home

Under Home's goal, **Ask sua to change Home** takes plain words, e.g. "put failing agents first and hide the draft agents" or "pin the Claude Code Usage Tracker failure". The conversation opens beside the list.

sua answers with a **Change Home** card that lists each change (new rules, pins, hides) and its effect: what will lead **Needs you**, and how many items will be hidden. **Apply** saves the changes as a new version of Home, marked "by you, through sua". Nothing changes before you apply. If Home changed in between, Apply refuses and you ask again. You can ask the same way in any conversation.

sua sees Home as it is (goal, sections, rules, pins, hidden items, and the items with their ids), so it can pin or hide a specific item. It prefers a rule when you say "always" or "all". It changes Home's sections only when you ask for exactly that.

### From AI apps (MCP)

- `surface-read`: Home's goal, sections with their items (ids, kind, title, why each is there), rules, and hidden items.
- `surface-apply`: `{ ops, reason, expectedVersion? }`. Changes are saved as made by the app (`agent:mcp`), and you can undo them. Changes to Home's sections are refused: you make those yourself. The tool policy applies.

### What changed, and why things are where they are

- **What changed** (next to Home's goal) lists every version of Home, newest first. Each version shows:
  - who changed it: you, you through sua, an app, or the defaults;
  - when, and the reason given;
  - each change in plain words ("Pin: “AQI + Smoke Inbox Reporter is failing” at the top").

  The latest change has **Undo**; older ones have **Go back to this**, and there's **Go back to the defaults**. Going back saves a new version, so it can be undone too.
- **The goal line** ("arranged by your rules, v3") stays current as Home changes, with no reload.
- **Rows show why**: when a pin, a move or a rule put a row where it is, the reason shows under it, once for a run of rows that share it. Hover any row for its reason, or open it for all of them.
- **Today keeps itself current**: while it's on screen, it re-reads every minute, so new failures, finished builds and answered questions move or go. It waits while you have a menu open, are dragging, or are typing in the list.
