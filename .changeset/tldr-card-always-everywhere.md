---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A TL;DR card set to Always shows on the page, the brief and the PDF, with the chosen photo credited.

Always used to show the card only on a page sua had drawn with a place for it, so on a ready-made page (Answer, Runbook, Plan…) it showed nowhere. Now such a page gets a full-width "In short" card after its opening row, on the page, in the brief and in the PDF (core `withTldrCardSlot`). The picture chosen for the notebook leads the card's photos in the brief and PDF too, not just the PNG; it's credited as it was given (the photographer) rather than by its site; and a photo shown large on the card carries its credit on it.
