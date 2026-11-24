---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The TL;DR card can be composed as an A2UI view around its photos.

Redrawing a notebook's TL;DR picture can now lay the card out freely: a photo full-bleed with the headline over it (`PhotoCover`), a grid of its photos (`PhotoGrid`), and any of the standard card's parts (`TldrPart`), arranged with Column, Row, Columns and Text. Every picture, name and number is bound from the card's own data (`/tldr/…`), never written in; each photo is credited on the card; a view that can't be drawn falls back to the fixed layouts. The PNG, the page's card and the brief and PDF draw it the same way. New in core: `checkTldrView`, `tldrViewGuide`, `TLDR_COMPONENT_NAMES`, and `ViewValidationOptions.tldr` (ADR-0096).
