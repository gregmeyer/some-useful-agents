# ADR-0093: The TL;DR card shows when it adds something

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

A notebook page with a Picture part bound to `/notebook/picture` draws the TL;DR card there, and its brief and PDF print it the same way. It was drawn whatever was in it. Sometimes it earns its place: a shortlist's bars show how the options compare, which no other part does, and a briefing leads with the person's photo. Sometimes it doesn't: an answer's card is the answer and its first findings again over a drawing, and in a PDF that's a third of a page saying nothing new.

## Decision

**Auto by default.** The card shows when it adds something the page doesn't say (`tldrCardAdds`):
- a chart: two or more options state the fact that ranks them;
- its sources' own photos (a subject briefing);
- who it's about, with their photo or logo.

Otherwise its data loses `notebook.picture`, so the Picture part draws nothing and goes, and the page brief prints nothing in its place.

**What you say wins.** `Notebook.tldrCard` (`tldr_card` column) is `'always'`, `'never'`, or unset (Auto). It is set under **Download / share → TL;DR card on the page** (`POST /notebooks/:id/tldr-card`). Never also drops the bars from a shortlist's brief.

**Asking for it counts.** A page change you asked for (the Edit page, or sua's layout action from the conversation) that adds the TL;DR picture sets the card to Always, unless you've already chosen.

**Redrawing doesn't count.** A redrawn picture (`Notebook.tldr`) is about how it looks when shared, not whether it belongs on the page.

The decision is made in one place (`showsTldrCard`) and used by the page, its live refresh, the page brief and the PDF.

## Consequences

- An answer or write-up page no longer repeats itself in a card, on screen or in the PDF.
- Existing pages follow Auto. Who asked for a page's picture wasn't recorded: a page you composed may have come with it. One click on Always puts it back.
- The TL;DR picture itself (Open, PNG, Redraw) is unchanged, so it can still be shared even when it isn't on the page.
