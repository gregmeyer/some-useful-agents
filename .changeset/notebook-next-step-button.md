---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook with steps left has a Next step button in its header.

While a notebook has steps left, the header's main button is **Next step →** (Try again for a stuck step, Finish after the last, "Working on step N…" while one runs), and Decide steps aside until the next move is yours. A check step without an agent no longer reads "needs an agent": it uses sua's checker.
