---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook step's own runs no longer show under "Runs not in this notebook yet".

A source step that reads each option's page (listing-page-facts) fills in facts on options the notebook already has, so its runs never add an entry. The notebook page listed them as runs to add, each with an **Add to notebook** button. A run that belongs to one of the notebook's passes now counts as in the notebook. A run's own page links those runs back to the notebook as well.
