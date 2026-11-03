# ADR-0068: A ready-made page you picked is still sua's to compose

- Status: accepted
- Date: 2026-11-03
- Deciders: Greg Meyer
- Builds on: ADR-0058 (a notebook decides its page), ADR-0064 (a page composed from what was written), ADR-0065 (representation levers)

## Context

Once an answer or plan is written, the page agent composes the page around it (a hero figure, parts by key, a lead number, what-ifs), but only while the page is the notebook's own pick (`layoutBy: 'notebook'`). Picking any card on Edit → How it looks, including "Let sua pick", saved the page as yours (`'you'`), so a person who chose "Answer" or "Plan" never saw the parts the canvas plan added, and the only way to get them was to go back to Edit after the answer was written. The live CD ladder notebook was in exactly that state.

Two intents were being conflated: "use this kind of page" and "leave my page alone".

## Decision

1. **A third owner, `picked`.** Saving a ready-made page (or the shortlist) from Edit sets `layoutBy: 'picked'`; "Let sua pick" sets `'notebook'` (it is sua's pick, as at setup); a page changed to your ask, or undone, stays `'you'`. The rule is by content at save time (`layoutOwner` in `lib/notebook-edit.ts`): a layout equal to a preset's is picked; anything else is yours; sua's own pick is marked in the draft.
2. **A picked page composes but keeps its kind.** `pageAfterWritten` runs for picked pages too, asking the page agent to keep the page's kind and parts and compose around what was written (the Edit ask inputs, `ASK` + `CURRENT`); the result is saved as `picked` again, so Answer again composes again. `pageAfterFirstStep` does not touch a picked page: sua never swaps it for another kind.
3. **The cards say so.** The Answer and Plan cards say sua composes them once written; the "Made for this notebook" card says when a page is left as you asked.

## Consequences

- Picking a ready-made page no longer opts out of the hero, lead and what-ifs; only asking for a change does, and that is what "as you asked" means.
- Undo still makes the page yours: an undo is a deliberate choice to stop sua changing it.
- Templates (`'template'`) and conversation-set pages (`'sua'`) are unchanged by this ADR.
