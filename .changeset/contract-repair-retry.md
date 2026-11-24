---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An answer in the wrong shape is asked for once more on the same provider before the next one is tried.

When a node requires a format (an output contract, such as an `<answer>` block) and the provider answers without it, that provider now gets one more try, told what was missing. Before, the node went straight to the next provider, often a paid one. If the second answer misses too, the node goes on as before.
