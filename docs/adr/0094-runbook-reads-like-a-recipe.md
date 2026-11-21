# 0094. A Runbook page reads like a recipe

- Status: accepted
- Date: 2026-11-20

## Context

The Runbook look (#1246) was the Answer page with new labels. A runbook someone follows needs another order:
- it led with research progress ("Done when");
- "what to have ready" came after the steps;
- a step that said "paste the prompt below" had the prompt in a separate panel after every step;
- what goes wrong was a plain grid;
- the findings, publishers, evidence, timeline and coverage all sat at full width after it.

A page made by the layout planner placed parts by key, and the key is the part's title. So a rewrite that renamed a part lost its place.

## Decision

- **Each part of a runbook has a role:** ready, method, trouble or background (`NotebookAnswerSection.role`).
  - The writer gives it.
  - An answer written before roles has them worked out from its kind and title (core `runbookRole`): steps and copy are the method; "what to have ready" is ready; a table led by a symptom, or a part about what goes wrong, is trouble; the rest is background.
- **AnswerSections places parts by role:** `roles: [...]`. A page placed this way keeps its shape across rewrites.
- **The part to copy goes inside the step that uses it:**
  - the step that names it (`copy`);
  - else the first step whose how says to paste or copy;
  - else after the steps (core `runbookCopyPlaces`).
  - It is drawn there once and not again on its own.
- **`style: "runbook"`** on AnswerSections and Figure draws:
  - each step as a card: a large number, how, ✓ what you'll see, an amber If-not aside, the copy part, and a Done box remembered in the browser only;
  - a trouble table as symptom → fix, with the cause beneath.
- **The brief prints the same**, each card kept whole on one page.
- **At a glance** (`/notebook/runbook/glance`, KeyValue) shows:
  - the total time, as the writer's `glance.time` or the steps' times added up when each is a number;
  - the number of steps;
  - who it's for and what you end with.
- **The Runbook preset is its own layout**, in this order: answer and glance; before you start; the steps; if something goes wrong; why it's done this way; sources; the research folded. Research progress stays in the header's fold.

## Consequences

- **Today's answers lay out right without a rewrite.** A rewrite adds the glance and real step times. The writer is now asked for numbers ("5–10 min"), not "a few minutes".
- **Old pages keep their layout.** A planner-made runbook page keeps its `only` keys until the runbook is re-picked. The layout guide now teaches `roles` and `style`.
- **The Done box is a per-browser convenience** (localStorage), not shared state.
