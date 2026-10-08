---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A newer price a search saw is no longer replaced by the price in the option's title.

Opening a notebook repairs facts that contradict an option's own text, which catches facts a model filed against the wrong option. It also undid real price changes: an option filed as "…, $279.99" that a later search found at $299.99 went back to $279.99. Its card and page then showed the old price while its history showed the rise.

Facts from a later search that found the same option again now win over the text it was filed with. Options already reverted are restored the next time the notebook opens.
