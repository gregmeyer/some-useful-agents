# ADR-0060: A notebook decides its page again after its first step

- Status: accepted
- Date: 2026-10-25
- Deciders: Greg Meyer
- Builds on: ADR-0058 (a notebook decides its own page)

## Context

A new notebook decides its page before it has anything: no options, nothing learned about who it's about. Its parts that wait for data (`when`) cover some of that, but it can't lead with someone it doesn't know about yet, and a page decided on its goal alone is a guess.

## Decision

- **Once its first step reaches its goal**, the notebook decides its page again, as it did when it was made, and says so in its conversation ("Now that it knows more, I redrew its page: …").
- **Only a page that's still its own.** A notebook records who set its page last: `notebook` (it decided), `sua` (a card you approved), `you` (Undo, Back to Shortlist), `template`. It decides again only when the page is its own pick, or the shortlist it started with. Undo counts as yours.
- **Steps added in front keep the others' ids**, so the notebook's step cards and history still point at the right steps.

## Consequences

- One more model call per notebook, when its first step is done.
- A page you changed is never redrawn on its own; Pick a page for what it's for still asks for one.
