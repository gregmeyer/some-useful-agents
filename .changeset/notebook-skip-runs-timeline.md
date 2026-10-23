---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Skip runs that don't belong in a notebook; timelines fold repeats and can be searched.

"Runs not in this notebook yet" gets **Skip** on each run and **Skip all**, so a run of a shared agent that was for something else stops being offered. The Timeline component (a notebook's "How we got here", an option's history, any view) folds the same event again in a row into one row with ×N and its time range, adds a search box past 8 events, and has calmer type and spacing.
