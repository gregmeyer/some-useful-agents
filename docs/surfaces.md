# Surfaces and items

sua's Home (and later boards, Notebooks and canvases in a conversation) is moving to **goal surfaces**: what you see is chosen by a goal and rules you can change, not fixed per page. The design is [ADR-0049](adr/0049-goal-surfaces.md). It has three layers that never mix:

1. **Items**: what is true. Typed objects read from what sua already stores. *(Shipped: the item index, below.)*
2. **Surfaces**: what is emphasized now. A versioned document per surface holds a goal, rules and your pins, and every change records who made it and why. *(Shipped: the surface model, below. Nothing draws it yet.)*
3. **Presentation**: a renderer turns a surface plus its items into the page. *(Next: S3, Home.)*

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
- **rules**, evaluated against items. Each matches on kind, urgency, state, source, agent, or item id or prefix.
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
