# ADR-0059: A notebook's header is part of its layout, drawn by the page

- Status: accepted
- Date: 2026-10-24
- Deciders: Greg Meyer
- Builds on: ADR-0056 (notebook layouts), ADR-0058 (a notebook decides its page)

## Context

A notebook's layout drew everything under its header, but the header (title, cover, purpose, buttons, steps, "Your step") was the same for every notebook. A meeting briefing still showed a shortlist's header. And nothing kept one part of a page from running a whole screen: the first drawn briefing opened with two long lists stacked.

## Decision

- **The header is a slot.** A layout may put a `NotebookHeader` first in its root. It says how the header looks: its cover (the lead option's picture, or none), a subtitle, whether it shows what the notebook is for, whether the steps strip is shown or folded to one line, and a `side` part drawn on its right from the catalog. The page still draws the header itself: its buttons are forms and its step cards are wired to the page's scripts, which can't reach inside an A2UI component. The side part is its own small surface on the same data.
- **No header in a layout means the usual header.** The shortlist and every page drawn before this look the same.
- **Lists have a length.** When a page is drawn, list parts get a default length and a cap, with "Show N more" past it: QuoteList 4 (at most 6), Agenda's questions 3 (5), Timeline 6 (8), Table 8 (12; a paged table is left alone). The shortlist's own grid isn't capped.
- **The guide asks for variety.** Open with a row of 2–3 short parts side by side, never two long lists stacked at the top; long lists go lower or in a fold.

## Consequences

- A notebook's page, header included, fits what it's for. The person's photo from the facts PR becomes another cover choice.
- One part can't take over the page whatever is drawn.
- The header can't be moved below other parts; it's always first.
