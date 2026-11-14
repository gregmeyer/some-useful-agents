---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Experiments, part 2: set one up, run it, and read what it found.

A new **Experiments** area. **New experiment** copies a notebook's options (or a pasted list) as the set to hold fixed, takes the things to vary (each level can change the agent's instructions, the person's preferences, the provider and model, or the agent version) and how many times to run each condition. **Run it** makes the runs two at a time; it can be stopped and gone on with, and a restart leaves it where it was. The page says what changed the result in a sentence, with how far the result moved for each thing varied against how far it moves between two runs of the same thing, each condition against the baseline, where each item landed, and every run. A new system agent, **Experiment ranker**, is the default thing run: it ranks a fixed list for a person's preferences following the instructions it is given. Experiment runs are kept out of the agent's own history, spend limit and state.
