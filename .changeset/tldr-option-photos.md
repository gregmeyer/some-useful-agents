---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A shortlist's redrawn TL;DR card can lead with its options' photos.

- **The bug.** When a shortlist leads with what it wrote, the card had no photo of its own, so "Lead with the photo" fell back to the notebook's drawing. The options' saved photos were never offered.
- **The fix.** The top options' own photos (up to four, each credited to its site) are now the card's photos when it has none of its own. "Lead with the photo" shows the best option's photo, and "Use its photos" puts them in a grid.
- **A layout fix.** The numbers and bars beside a photo in a composed card now fit their column instead of running off the card.
