# ADR-0086: Surfaces update in place

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

A notebook page polls its main column every 5 seconds, and a composed board polls its data. A new copy was taken in place only when its components were the same as before, by sending the data model again.

Any change to a component redrew the whole column or board: a part appearing as a step finished, a finding's tag, a skeleton turning into its part. The redraw flickered, scrolled, and closed what you had open.

A2UI 1.0 (ADR-0084) upserts components by id (`updateComponents`), and sets or deletes data at a path (`updateDataModel`, where `null` deletes).

## Decision

**A drawn surface takes a new copy of itself as a delta.** `assets/surface-diff.js` (pure, unit-tested) compares the copy with what the surface was drawn from:
- **Components:** it sends only those that changed or appeared. A component that went is no longer any parent's child, so it isn't drawn.
- **Data:** it sends only the paths that changed, down to two levels (`/notebook/findings`, `/notebook/answer`), with `null` for a key that went.

`updateSurface` in `a2ui-sua.js` applies the delta to the mounted processor and remembers the new copy. A new copy that sends nothing sends nothing. Another surface, or one with no root, still redraws.

A board's poll merges new tiles into the tile registry first, so a tile the delta adds finds what it shows.

## Consequences

- When a step finishes, its part appears where it belongs and the rest of the page stays as it was: the same element, nothing redrawn. This was checked in a browser on a live notebook, adding a part and changing the answer, then taking both back.
- The page still asks every 5 seconds; nothing pushes yet. Pushing the delta from the server, over the existing WebSocket and inbox events, is the natural next step, now that a delta is what gets applied.
- A change to the steps in the page's header still reloads the page; that is HTML outside A2UI. Chat streaming still redraws its widget while it's being written.
