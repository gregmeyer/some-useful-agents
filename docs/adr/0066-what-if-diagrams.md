# ADR-0066: What-if controls on code-drawn diagrams

- Status: accepted
- Date: 2026-11-02
- Deciders: Greg Meyer
- Builds on: ADR-0047 (the model's output is never drawn unchecked), ADR-0064 (a page composed from what was written), ADR-0065 (representation levers)

## Context

A notebook page had nothing to do on it. An answer's diagrams (a CD ladder, how an amount splits) were drawn by code from the writer's numbers, but static: a reader asking "and with $30,000?" or "over six years?" had to ask sua again. A Claude artifact's best moment is often a slider the reader moves while a drawing follows. The user chose to add that moment, with the same line as before: no model-written JavaScript or markup; the writer names what can move, and code does the moving.

## Decision

1. **The writer names what-ifs, not code.** A ladder or a split may carry up to two `params`, each a key the diagram can move: `amount` (the whole a split or ladder divides; a ladder only when every rung has an amount), `months` (a ladder's longest term), `count` (its number of rungs). The writer may give a label and a range; the **value is always the diagram's own**, read from the diagram (its total, its longest end, its rung count), so the slider's rest is what was written. A range that doesn't hold the value, or a key the diagram can't move, is dropped; sua fills a sensible range when none is given.
2. **One pure recompute, shared.** `recomputeDiagram(d, values)` in core: a split re-divides the amount in the parts' own proportions; a ladder scales rungs' amounts and terms the same way; another count rebuilds equal rungs up to the longest term (labels say the term, no rate can be known). Whole dollars and months, the last part taking the rounding, out-of-range values clamped, and the written values give the diagram back unchanged. The browser gets the same arithmetic as `assets/diagram-math.js` (recompute and layout, mirroring `answer-art.ts`); a test runs both over fixtures and moves and asserts they agree, the way `chart-math.js` is kept honest.
3. **The page moves; the notebook doesn't.** The diagram view carries its `source` and `params`; the client draws a slider row above a diagram that has them, recomputes and lays it out again on input, and keeps what the reader moved it to in `localStorage` by page and part (try/catch; a blocked store still moves). Reset clears it. Nothing is written to the notebook, so other readers, the brief and `notebook-read` see the diagram as written; the brief says where it moves.
4. **The page agent knows.** A written part's shape (ADR-0064) says `whatIf: [keys]`, and the agent prefers such a diagram as the hero.

## Consequences

- A reader can try a number without a round trip or a rewrite, and the written answer stays the answer.
- Interaction stays code: the catalog of what can move is three keys on two diagram types. A new kind of what-if (a rate, a date) is a change here, not a prompt change.
- Two copies of the arithmetic exist (TypeScript for the server and brief, a browser module for the page); the agreement test is what allows that, and either copy changing without the other fails it.
