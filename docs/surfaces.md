# Surfaces and items

sua's Home (and later boards, Notebooks and canvases in a conversation) is moving to **goal surfaces**: what you see is chosen by a goal and rules you can change, not fixed per page. The design is [ADR-0049](adr/0049-goal-surfaces.md). It has three layers that never mix:

1. **Items**: what is true. Typed objects read from what sua already stores. *(Shipped: the item index, below.)*
2. **Surfaces**: what is emphasized now. A versioned document per surface holds a goal, rules and your pins, and every change records who made it and why. *(Next: S2.)*
3. **Presentation**: a renderer turns a surface plus its items into the page. *(S3: Home.)*

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
