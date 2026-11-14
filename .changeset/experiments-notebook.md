---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Experiments, part 4: an experiment's results as a notebook.

An experiment's results only showed on its own page. **Show it in a notebook** now makes a notebook of a new type for it: the page leads with what the experiment found, then the figures, each condition against the baseline with every score, each change by itself, and where each item landed. It is read from the experiment's latest pass each time, so it never goes stale, and an open page redraws as runs come back. The notebook is where you talk to sua about the results, and sua is given the counted finding and tables. It has no steps and nothing to decide; its main button opens the experiment, which is still where runs are made.
