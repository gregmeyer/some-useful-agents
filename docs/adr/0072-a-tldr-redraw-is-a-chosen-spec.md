# ADR-0072: A TL;DR redraw is a spec sua chooses, not a picture it draws

- Status: accepted
- Date: 2026-11-10
- Deciders: Greg Meyer
- Builds on: ADR-0056 (layouts as data), ADR-0071 (what a notebook is about, kept apart from its words)

## Context

A notebook's TL;DR picture is built from its data with no model: the best lead, a few numbers, the options as ranked bars. People wanted to ask for it differently in their own words: "make it suitable for sharing on LinkedIn", "more editorial", "be more creative".

There were three ways to let a model do that:

- have it write the picture's HTML and CSS;
- have it write an A2UI layout document, as notebook pages are;
- have it choose from a fixed set of designs that our code draws.

## Decision

1. **The model chooses a spec; code draws.** A redraw is a `TldrSpec`: one of four sizes (standard, landscape 1200×627, square, portrait), three tones (plain, editorial, bold), six layouts (stack, split, hero, and three that lead with a picture: cover, lineup, spotlight), which parts in what order, and at most a headline and a one-line takeaway. `tldrCard` draws any spec from the same `TldrData`. Every result is legible and on brand, and the picture cannot contain something the notebook doesn't.
2. **Not raw markup.** Model-written HTML has no safe path here (the PNG is made in a real browser), breaks the brand rule that agents don't write colours or fonts, and the codebase already found model-drawn pictures poor. It was offered and not chosen.
3. **Not an A2UI layout document.** The static renderer for layouts is built for a page (masthead, reading width), has no image part, and its bars don't follow the picture's rules for what to plot. A card-sized vocabulary of twelve choices is easier for the model to get right than the page guide.
4. **The model may write two lines, and their numbers are checked.** A headline and a takeaway are the only words written for the picture. Any number in them must appear in the data the model was given, as written there. A miss is retried once with the reason; a second miss drops the words and keeps the drawing.
5. **Fixed sizes have budgets.** A feed image is an exact box, so each size says how many bars and points it holds; the rest are counted. Bars are measured against the longest one shown.
6. **The result is kept, with undo.** A notebook stores its spec (`tldr_json`) and the last ten it replaced (`notebook_tldr_history`). No spec means the standard picture, which is always reachable.
7. **The brief is untouched.** The brief and PDF carry the plain bars only; a redraw is for the picture that travels alone.

## Consequences

- "Be more creative" is bounded: 4 × 3 × 6 drawings and two lines of words.
- A layout that leads with a picture is drawn only when there is one. That is decided in code from the data (`tldrLayoutFor`), not by the model: a lineup without three pictured options, or a cover without the lead's picture, falls back to the closest layout that works. A photo is framed whole over a blur of itself, so the varied pictures notebooks keep (small, tall, banner-shaped, logos, drawings) all sit well; a full-bleed photo behind text was considered and not built for that reason. More designs can be added to the lists without changing the agent's contract.
- A redraw costs one short model run (two when the first answer can't be used).
- The number check is literal: "$140" for a stored "$139.99" is refused. That is deliberate; rounding is how wrong numbers start.
- Redraw state while the agent runs is in memory. A restart mid-redraw loses the ask; the picture stays as it was.
- Only the Redraw page asks for a redraw. sua's conversation doesn't (the triage kernel is unchanged).
