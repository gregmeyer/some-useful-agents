---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's shortlist filters by the last run: new, seen again, or earlier.

After a re-run, the new options carry a "new" tag. The header links to "N new in the last run", which opens the shortlist showing only those. Previous / Next on an option's page follows the filter. A step or pipeline run of several agents counts as one run. Options get an `added` field (`new` | `again` | `earlier`) in the notebook's view data, and the store gets `lastFindAt`.
