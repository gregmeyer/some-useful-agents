---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Experiments: sua reads your question to help choose the set.

The set step ranked your notebooks on what they hold, but couldn't tell what your question needs. Now, when the step opens, sua reads the question (and what you change) and names the facts the rankings will turn on. Each notebook then says for how many of its options those facts are noted, counted by code, and one that lacks them says so; the suggestion moves to sua's pick only when that notebook has enough options and notes those facts for most. sua can only name facts your notebooks note and notebooks that are listed. It takes about ten seconds, the counted list shows meanwhile, and it stands if the reading fails. A new system agent, **Experiment set advisor**, does the reading.
