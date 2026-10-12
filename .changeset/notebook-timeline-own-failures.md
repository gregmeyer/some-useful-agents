---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

A notebook's timeline shows only its own failed searches.

A failed run of an agent that feeds a notebook showed on its timeline even when the run was for another notebook: three starter-research failures from a comp-set notebook showed as "Search failed" on a guitar notebook and a cabinet notebook. Now a failed run shows when it was made for that notebook (its pipeline, steps or conversation), or when its agent works only for that notebook.
