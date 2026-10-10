---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's long facts are filtered by short labels sua gives them.

When a fact is a sentence per option ("Office-of-CFO suite: close, consolidation, compliance, disclosure"), a new system agent, `notebook-facets`, groups its values into a few short labels ("Office of the CFO", "Finance-led FP&A"), kept on the notebook. The shortlist's filter chips use them, and so does Previous / Next on an option's page. It runs in the background when a notebook opens and a value has no label yet, reusing the labels already there.
