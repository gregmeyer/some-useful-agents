---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Each notebook option has its own page.

`/notebooks/<notebook>/entries/<option>` shows everything the notebook keeps about one option:
- **Header:** its picture and price, and where it stands (best price, or #3 of 12). It has the same Move, Rule out and Bring back controls as the cards, and they return to this page.
- **Facts:** every fact, with its source, estimate mark and the quote that backs it.
- **Price over time.**
- **Checks:** the notebook's checks for this option, whatever its rank.
- **History:** found, seen again with price moves, moved, and ruled out and why, each linked to its run.

Two shared widgets also changed. A KeyValue item can link its value (`url`) and carry a short line under it (`note`), and a Checklist group with an empty title has no heading.
