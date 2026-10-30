---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Correcting an option's fact checks that option again.

Say "the Artisan is actually $450" in a notebook's conversation, and sua's correction card now covers an option's facts too. Apply changes the fact and forgets the option's results for the checks that rest on it. The notebook's check step then checks just that option again, on just those checks. An option one of sua's checks ruled out comes back in to be checked again. A picked option that now fails a check stays picked, and sua says which check it fails. Talking points that cite the option are written again. New: `NotebookStore.clearChecks`.

The correction card also reads better. It names an option by its company ("Extend, Salary: $225,000–$250,000 → $150,000–$180,000"). Option facts show as formatted values (ranges, money). Evidence the card flags but Apply doesn't change shows as "may be out of date". When an option's recheck rules it out, sua says so and why.
