# ADR-0073: Home's Next up: code picks the items, a model words them

- Status: accepted
- Date: 2026-11-11
- Deciders: Greg Meyer
- Builds on: ADR-0049 (goal surfaces: Home is compiled from items and rules), ADR-0072 (a model chooses among things code can do)

## Context

Home had nothing to say on a normal day. Its surface (ADR-0049) is built from things that need you or are happening: waiting conversations, failing agents, active notebooks. Someone who archives a notebook when it's done, and whose agents mostly work, got "All clear" over rows of generic starter pills. The front-page layout for boards (ADR-0070) didn't help as a landing point: it lays out what a board's agents produced, and says nothing about what to do next.

What was wanted: a short list of specific next actions drawn from the person's own notebooks, agents and conversations, each with a button that does it.

Three ways to produce that list:

- **A model decides.** It reads the notebooks, agents and conversations each morning and proposes what to do. Most interesting, but every suggestion then needs checking that it refers to something real and that there is a button that can do it.
- **Code only.** Rules pick items from the stores. Always true and instant, but the order and the wording are mechanical.
- **Code picks, a model words.** Rules pick the items; a model only orders them and writes each one's line of why.

## Decision

**Code picks, a model words.**

1. `nextCandidates` (dashboard `lib/home-next.ts`) builds every item from the stores, with its title, its button, and the **facts** it rests on ("9 failed runs of 55 in the last 30 days"). `pickNext` takes at most five, at most two of a kind. This is the whole feature without a model.
2. The `home-next` system agent is given the shown items as `{id, kind, title, facts}` and returns an order and a line of why per id. It never sees or writes a button, a link or a title.
3. Its answer is checked in code (`parseNextWords`): ids it wasn't given are dropped; a why is kept only if it is one line of at most 140 characters whose every number appears in that item's own title and facts. Anything else falls back to code's wording for that item.
4. The wording is cached per list (a hash of the item ids) for 12 hours. Home never waits: it shows code's version, starts the run in the background, and the next redraw shows the worded one. A failed run keeps what was there and waits ten minutes before another try.

**Archived notebooks are patterns, not targets.** They say what kinds of notebook someone makes and about what (templates used, tags shared by several). An item may offer to start another like the latest one; it never offers to reopen or rerun an archived notebook. Archiving is how the person says "done".

**Next up is a part of Home's page, not a region of its Today list.** Its items aren't surface items, so rules and pins don't apply to them, and "Not now" is a week-long dismissal of that item (stored with the item dismissals, ids prefixed `next:`), not a surface rule.

**The page's parts are in the surface document** (amended 2026-11-11). `parts` lists Today, Next up, Ask sua, Housekeeping (main column), Today's reads and Your notebooks (side column) in order, each optionally hidden. Three ops change it: `movePart` (within its own column), `hidePart`, `showPart`. They are structural: you make them, directly or through "Adjust Home"; an agent on its own can't. Today can't be hidden, since it is where what needs you shows. A hidden part isn't read at all (a hidden Next up starts no wording run) and is named at the foot of Home with **Show**.

## Consequences

- Every item on Home can be done: its button was built by the same code that found it.
- With no model, a slow model or a bad answer, Home still shows a correct list.
- The model can't invent a recommendation. Ideas no rule would find ("you keep asking about X; make it a notebook") stay with the notebook suggester on New notebook.
- One short model run per list per half day, only when Home is open.
- "Adjust Home" can move or hide Next up as a whole. Arranging its individual items with rules ("never suggest scheduling") would need them to be surface items; that is a later step.
- The number check is strict: a why that says "nine" as "9" when the facts say "9" passes, but one that rounds or adds a figure is dropped. That costs some good sentences and is the right side to err on.
