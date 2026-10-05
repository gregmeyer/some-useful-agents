---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Notebook options remember their price history and notice when they stop showing up.

- **Price history:** each time a search finds an option, what it said is kept. Cards show how the price moved ("↓ $123 since Oct 5"), green when that's better and amber when it isn't.
- **Not seen lately:** each search is recorded. An option that the last 2 searches passed over (while finding other options) says "not in the last 2 searches", since it may be sold or filled. A search that found nothing doesn't count.

Both are in `data.json` (`priceHistory`, `priceChange`, `missedSearches`, `notSeenLately`) for the notebook widgets.
