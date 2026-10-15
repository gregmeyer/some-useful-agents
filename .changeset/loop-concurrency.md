---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A loop can run its items at the same time.

`loopConfig.concurrency: N` (1–6, default 1) runs up to N items at once. The results keep the items' order and a failed item is `null`, as before. Stopping the run starts no more items. This lets a big search become several small ones (one per site, each within its own turn limit) that take about as long as one.
