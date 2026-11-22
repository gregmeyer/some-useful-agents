# 0096. The TL;DR card can be composed as an A2UI view

- Status: accepted
- Date: 2026-11-21
- Supersedes: decisions 2 and 3 of [ADR-0072](0072-a-tldr-redraw-is-a-chosen-spec.md), and its note that a full-bleed photo behind text was not built

## Context

ADR-0072 made a TL;DR redraw a chosen spec: the `notebook-tldr` agent picks a size, a tone, one of seven layouts and the parts, and may write a headline and a takeaway. It chose that over an A2UI document because:
- the static renderer was built for a page;
- the renderer had no image part;
- a model's bars wouldn't follow the card's plotting rules.

That kept every number honest. But "more creative" could only move between seven fixed layouts, and a photo could never carry the headline over it, which is what a share card usually wants.

## Decision

- **A redraw's spec may carry `view`.** This is a list of A2UI components that lays the card out. With a view, `layout` and `parts` don't apply; size, tone, headline and takeaway still do.
- **Three components are for the TL;DR card only.** They are in the sua catalog, and the validator refuses them anywhere else unless `tldr: true` is set.
  - `PhotoCover`: a photo full-bleed with words over it on a scrim, with its credit drawn on it.
  - `PhotoGrid`: up to four photos, each credited.
  - `TldrPart`: one of the standard card's parts, drawn exactly as the standard card draws it, so bars keep their plotting rules.
- **Layout components.** Besides those three, a view may use only Column, Row, Columns and Text.
- **The agent binds, it never writes in.**
  - Every binding must be one of the card's own paths (`/tldr/title`, `/tldr/headline`, `/tldr/photo`, `/tldr/photos/N`, …). The dashboard fills them from the notebook's data, so a picture's address, a name or a number never comes from the model.
  - The words the view writes itself are checked like the headline: a number that isn't in the card's data sends it back once, then the view is dropped.
- **`checkTldrView` (core) decides whether a view is kept**, through `cleanTldrSpec`. It checks:
  - a valid A2UI view;
  - only the allowed components;
  - one root;
  - at most 25 components;
  - only `/tldr/` bindings.

  A view that fails is asked for once more with the reasons, then left out, and the card is drawn with its layout as before.
- **One renderer** in the dashboard (`views/notebook-tldr.ts`) draws a view inside the same card box, sizes and styles. The PNG, the page's card and the brief/PDF all use it, so they match.
  - A cover runs to the card's edges.
  - Credits are drawn by the renderer, not the model.
  - The card's foot ("Made with sua") is always there.

## Consequences

- "Be more creative" and "the headline over the photo" get real layouts, still from the notebook's own data.
- The three components aren't drawn in the browser's A2UI renderer: they exist only on the card, which is a PNG on the page. If a page ever wants a photo cover, it needs a browser element first.
- The seven fixed layouts stay, as the default and the fallback.
