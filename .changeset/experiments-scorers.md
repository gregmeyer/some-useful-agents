---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Experiments, part 3: score each result, by counting or with a judge.

An experiment could say which conditions gave different results, not which gave better ones. It can now carry up to three scorers. **Items that should be near the top** is counted in code. A **judge** is a model that reads each result against a rubric you write and gives 0 to 100% with a reason; it is shown the items, the person's preferences and the ranking, never which build produced it, and its answer counts only when it is a number in range with a reason that names real items. Each condition's row shows every score averaged over its runs, with the lowest and highest, and every run lists its scores with a link to the judge's own run. A new system agent, **Experiment judge**, does the judging.
