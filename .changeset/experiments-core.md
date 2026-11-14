---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Experiments, part 1: the store and the measures (ADR-0078).

An experiment holds a frozen set of items, the things to vary (factors and their levels: an agent version, instructions, a model, inputs) and how many times to repeat. A pass runs every combination and is kept cell by cell, so it can be stopped, resumed and survives a restart. What changed the result is counted in code from the rankings the runs returned: how many of the top items stayed and how far items moved, for each factor, against the variation between repeats of the same condition. Experiment runs are filed under their own id (`experiment--<agent>`), so they never show up as the agent's own results or count against its daily spend. No pages yet; those follow.
