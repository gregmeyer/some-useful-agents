# ADR-0064: A written notebook's page is composed around what was written

- Status: accepted
- Date: 2026-11-02
- Deciders: Greg Meyer
- Builds on: ADR-0056 (layouts as A2UI documents), ADR-0058 (a notebook decides its page), ADR-0060 (decided again after the first step)

## Context

A notebook's page is drawn before its content exists. The page agent sees the notebook's setup (what it's for, its facts, its steps) at creation and once more after the first step, never what the writer wrote. So an answer notebook keeps the ready-made Answer page: the answer, then every written part in one block in the order written, then the findings and the evidence. The CD ladder notebook's best part, the ladder, sits a screen and a half down at a third of the column width, under a nine-row rubric and a twelve-row terms table. A page that reads like an artifact is laid out from the content, with one thing leading.

Two things stood in the way: the page couldn't place a written part on its own (every part rendered inside one `AnswerSections`), and nothing told the page agent what was written.

## Decision

1. **Each written part has a key.** `cleanAnswerSections` gives every answer and plan section a `key` from its title (`a-simple-rubric-for-the-25-000`), unique within the write; `sectionKey()` derives one for parts stored before. A rewrite that keeps a title keeps its key, so a page drawn around a part finds it again.
2. **Parts are placeable.** `AnswerSections` takes `only: [keys]` (those parts, in that order; a single key draws without its own title, the Panel's title says it) or `rest: true` (the parts no other part of the page places). `resolveNotebookLayout` turns `rest` into `skip` of every key the page places, by `only` or by a `/notebook/section/<key>` binding, and with the notebook's data prunes a part whose keys are gone and a leftovers block with nothing left. `/notebook/section/<key>` is a data path (one part, the same shape as an `answerSections` item). Paths and keys are added, never renamed.
3. **The page agent sees the shape of what was written, not its words.** `notebookForPage` adds `written`: the kind (answer or plan), how much it rests on, and each part's key, title, kind, size and what it delivers. The guide and the agent's prompt say to compose around it: one hero, each part where it reads best, long tables low or folded, one `rest` block for what's written later.
4. **Composed after writing, every time.** When a write step of shape answer or plan meets its goal, and on Write again (Answer again, Plan again, Update all), `pageAfterWritten` lets the notebook decide its page again, under the same rule as ADR-0060: only while the page is still its own pick. The conversation says what leads; Undo puts the page before back.
5. **The eval covers it.** The question and trip examples carry written parts; the recorded answers gain a `written` reply, and the eval script asks twice (bare, then written) and scores whether the written page is composed (drawn, parts placed, a leftovers block).

## Consequences

- Answer and plan notebooks get a page laid out around their content once they're written, with no approval card, and keep it until they're written again or you change it.
- Pages saved before are unchanged until their notebook is written again.
- A part a page names by key that the writer drops leaves its place out rather than an empty box; a part written later shows in the leftovers block, so a composed page never hides new writing.
- Shortlists, meeting briefings, company briefings and watches aren't composed this way yet; the same `only`/`rest` levers are there for them.
- What a hero can be is still bounded by the catalog: a diagram or table drawn inside `AnswerSections`. Representation components (a hero figure, a lead number, bars by a field) come next.
