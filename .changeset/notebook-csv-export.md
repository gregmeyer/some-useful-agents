---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Download a notebook's shortlist as a spreadsheet.

**Download CSV** in a notebook's header saves the shortlist best first, with a column per fact, estimates, sources, the quote that backs the ranking (and whether it was checked), checks done, and when each option was seen. `?all=1` adds ruled-out options with why. Formula-like text is neutralised so a shared sheet can't run it.
