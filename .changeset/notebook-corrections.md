---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Correcting an option in a notebook's conversation now changes the option itself.

sua had no way to change an option's facts. "The price is actually $136.64" became a separate evidence note, and the option's card, page and chart kept the old price. sua can now update an option's facts directly (an `update` change in `notebook-add`):
- **History:** the option's page shows "Corrected" with what was replaced.
- **Sources:** the fact's old source and estimate mark are dropped.
- **Precedence:** the correction stands over the option's title and over earlier searches.
- **Price history:** a corrected price starts it over, so fixing a wrong price doesn't read as a price drop.
