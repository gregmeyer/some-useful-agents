# ADR-0049: Goal surfaces: semantic objects, a surface model, then rendering

- Status: accepted
- Date: 2026-10-03
- Deciders: Greg Meyer

## Context

sua's boards are built like dashboards. The tree operations (`core/src/board-tree.ts`) are
positional (insert, move, wrap, span), and every leaf is an `AgentTile` or `SystemTile`. That
gives `Agent A tile | Agent B tile | Agent C tile`. The arrangement follows which agents exist,
not what the user is trying to understand or do. If three agents each know one thing (a deadline
is at risk, revenue is down 12%, three approvals are waiting), the board shows three tiles. It
should show one "Needs attention" group.

Some things are already right and should be kept:
- A2UI v0.9 is a trusted, declarative catalog (ADR-0047). Nothing renders generated code.
- The editor and agents (`board-place`) share one server-applied operation path.
- Board documents are versioned and can be undone.

What's missing is the layer between what agents produce and what gets drawn.

Home is becoming the inbox canvas (conversations phase 3b), and its top region is the first place
this matters.

## Decision

**Target architecture: agents/tools → normalized semantic objects → surface model → renderer.**
Not agents → widgets → grid. A grid is one way to render, not the product model.

1. **Canonical state: normalized semantic objects ("items").** Typed objects that exist apart
   from any rendering: `fact`, `metric`, `status`, `alert`, `question`, `decision`, `action`,
   `progress`, `evidence`, `collection`, `relationship`. Each item has:
   - a stable id;
   - subject references (agent, run, board, thread);
   - urgency and state;
   - typed actions (approve, retry, reply, run), carried out by the store that owns the truth;
   - evidence references;
   - provenance (which agent, run or system produced it, and when).

   The first items are projections of stores sua already has: inbox threads and action cards,
   human questions, run outcomes and evidence, failures, scheduler health, board builds. Later,
   agents emit them directly. An agent's tile mapping (`signal`) becomes an item producer, so its
   output joins the item layer instead of only filling a tile. Once agents emit Alert, Metric,
   Decision, Action, Evidence or Collection, a surface can combine several agents' outputs into
   one coherent view instead of arranging their outputs.

2. **Surface state: what's emphasized right now.** A versioned document per surface (Home first)
   holds:
   - a **goal** ("only things that could change what I do today");
   - declarative **rules** evaluated against items (filter, promote, group, collapse, hide,
     represent, limit);
   - item-level **overrides** that capture meaning, not coordinates (pin, rank, group with, hide,
     expand, persist).

   Every version records its **actor** (you directly, you in conversation, an agent, or the
   system) and a **reason**.

3. **Presentation.** A deterministic compiler turns the surface document plus items into an A2UI
   tree built only from trusted primitives: text, metric, list, timeline, table, form, status,
   alert, chart, action control, expandable evidence, grouped or nested structures. Models choose
   and compose these primitives through declarative descriptions. They never write code. An agent's
   identity appears as provenance, and as structure only when a rule groups by agent because that
   identity is useful.

**One mutation path for every source of change.** `applySurfaceOps(doc, ops, actor, reason)`
handles semantic operations: setGoal, addRule, removeRule, pin, rank, group, ungroup, hide, show,
expand, collapse, represent.
- **Direct manipulation** maps gestures to meaning. Dragging an item to the top ranks or pins
  it; dropping it onto another groups them. sua always offers to turn a gesture into a rule
  ("Make this a rule? Always put approvals first"); it never infers rules silently.
- **Conversation**: sua proposes the same operations as a preview card that you Apply.
- **Agents and the system** use the same operations, recorded with their actor.
- **New canonical state** re-runs the rules. A newly critical issue lands where the rules put it,
  and the surface says why.

Changing presentation never changes canonical state. Changing canonical state updates every
representation that shows it.

**Mutable structure with stable anchors.** A fully fluid UI is disorienting. As composition gets
more dynamic, persistence, predictable regions, undo and explicit preferences matter more, not
less. So:
- **Regions are stable.** A surface has named regions (on Home: needs you, what changed, your
  conversations) whose position and order do not move unless you move them. Rules reorder and
  regroup items *within* a region. A new region appears only when you or a rule you approved
  asks for it.
- **The system proposes; it doesn't restructure on its own.** System and agent changes that would
  add, remove or reorder regions arrive as proposals, the same as conversational ones. Promoting
  an item inside a region under an existing rule happens on its own, with a visible reason.
- **Persistence and undo.** Every change is a version with an actor and a reason. A "What
  changed" view shows the history, and any version can be undone.
- **Explicit preferences win.** A pin or rank you set outranks a rule; a rule you set outranks a
  default; nothing an agent does silently overrides either.

## Consequences

- **The test every surface feature must pass:** can the same intent, said in conversation or done
  by direct manipulation, update one durable model? And can the surface organize itself around
  the user's goal instead of the agents that produced the data?
- **The question to ask when adding a feature:** does it add another container, tile or layout
  mechanism, or does it increase the surface's ability to represent and manipulate meaningful
  state? Prefer the second.
- **New code:**
  - core: an item index and a surface store (versioned, with actor and reason);
  - `applySurfaceOps`, a rule evaluator, and a compiler from surface to A2UI;
  - semantic components in the A2UI catalog;
  - a sua action, `adjust-surface`, and an MCP tool, `surface-apply`.

  Order and scope: `~/.claude/plans/goal-surfaces.md` (S1 items, S2 surface model, S3 Home renders
  its surface, S4 gestures, S5 conversation, S6 system initiative + provenance + history).
- **Boards keep working as they are.** Later, they become surfaces: `AgentTile` stays as one
  representation, and a board can also hold semantic groups that span agents. Until then, the
  board tree operations (ADR-0047) are the presentation-level editor for boards only.
- **Items start with what the system already knows** (threads, approvals, questions, failures,
  health, builds). Agent facts and metrics come once agents can emit typed objects, which also
  makes them useful outside the dashboard (MCP, notifications).
- **Rules are declarative data, not code.** A rule an agent proposes can be inspected, versioned
  and undone like any other change.
