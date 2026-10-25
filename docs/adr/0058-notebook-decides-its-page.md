# ADR-0058: A notebook decides its own page

- Status: accepted
- Date: 2026-10-24
- Deciders: Greg Meyer
- Builds on: ADR-0056 (notebook layouts as A2UI documents)

## Context

ADR-0056 made a notebook's page a document, and sua can draw a new one when you ask. But every new notebook still started as a shortlist, a page for choosing among many options. A notebook that prepares you for a meeting, or answers a question, got a ranking with prices and Pick buttons until someone asked for something else.

## Decision

A new notebook decides its page itself, from what it's for.

- **When.** Once it's set up (what it's for, the facts it notes with their roles, its steps), before sua says hello. The facts and roles have to exist first, because the page binds to them.
- **Who.** A system agent, `notebook-page`, keeps the ready-made shortlist for a choice among many, or draws a page that fits another outcome (a briefing, an answer, a plan) with the catalog's components. It reads the same layout guide sua uses for "change the page".
- **No approval.** You approved the notebook, so its page isn't a second question. The page is checked like any layout. One that doesn't check out gets one more try with the reasons; after that the shortlist stays. Undo on Edit (and Back to Shortlist) put it back, and the greeting says what was drawn.
- **What it never replaces.** A page the notebook came with (a template's), or one set while it decided (a card, by hand).
- **Again, on purpose.** Edit → More → "Pick a page for what it's for" lets an existing notebook decide again. Old notebooks don't change on their own.
- **The drafter is unchanged.** The notebook decides after the draft, from its own setup, so every way of starting one (draft, skip, sua's card) gets the same behavior.

## Consequences

- Each new notebook costs one more model call (two when the first page doesn't check out). A shortlist notebook's answer is short.
- Notebooks that aren't choices start with a page that fits. Notebooks that are choices look the same as before.
- New ready-made pages (a briefing preset, a report) only need adding to the preset list: the agent prefers them when they fit.
