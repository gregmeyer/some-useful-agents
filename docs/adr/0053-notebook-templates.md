# ADR-0053: Notebook templates are setup only, and sua asks before creating

- Status: accepted
- Date: 2026-10-15
- Deciders: Greg Meyer

## Context

Some notebooks get run again and again: a job search, a car search, a comp set. Setting one up means a draft, then fields, checks, stages and steps, and the user often recreates the same setup by hand. They asked to turn a notebook into a template ("job search template", with a notebook as the seed) and to have sua ask clarifying questions before creating the next one.

Until now, nothing copied a notebook, sua couldn't create one (it only linked to New notebook), and the drafter never asked questions.

## Decision

**A template is a notebook's setup, saved under a name, and sua starts new notebooks from it in a conversation, after asking what's different.**

1. **Setup only.** A template keeps:
   - what it's for, the limits and the done-whens (texts only);
   - the fields, checks and stages;
   - the steps, with their agents and status reset;
   - the schedule and pipeline.

   It never keeps options, notes, a decision, history or facet labels, so every notebook made from it starts empty. Templates live in `notebook_templates` (id = slug of the name; saving the same name again replaces it; uses counted).
2. **sua asks in the conversation, not a form.** The kernel gets `TEMPLATES`. It asks at most 4 short questions, one or two per reply, each as buttons led by the template's own value. Then it proposes `notebook-create` with the whole updated lists. It never proposes before the questions are answered or skipped.
3. **A card, then one way to create.** `notebook-create` is a route-handled action with a preview (template, title, limits before → after, done-whens, steps). Approving it calls `createNotebookFrom`, the same function the New notebook form uses. Step agents that are no longer installed are dropped, and nothing runs until the user starts the first step.

## Consequences

- A repeat search takes a sentence and a few button presses instead of a draft and a setup.
- Templates go stale only in their agents, and those fall back cleanly.
- The New notebook form and sua create notebooks the same way, so a change to setup or greeting applies to both.
- A template doesn't carry what was learned last time: notes, ruled-out reasons, which sites came up empty. That was considered ("setup + lessons") and left for later.
