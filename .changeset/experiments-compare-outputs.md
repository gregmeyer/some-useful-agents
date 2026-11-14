---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Experiments now compare what whole runs produce (ADR-0079).

An experiment used to copy a list of items, re-rank that same list under each condition, and compare the orders. That couldn't see what an agent finds, which is most of what it recommends. An experiment now gives one of your agents the same ask under different versions of it (an earlier version against a later one, another model, another value for one of its inputs), runs the whole agent a few times under each, reads the items each run's output lists, and counts how much the versions' results have in common against how much two runs of the same version do. Its page shows what each version found, the items they disagree on first.

Setting one up is six steps: the question, the agent (yours, the most run first, searchable), what you ask it (starting from its last run's inputs), what changes, scoring, and a summary. Scores are now "should be in the results" and "should not be", counted, and a judge that reads what a run produced.

Removed: the frozen-list kind, the Experiment ranker and Experiment set advisor agents, the golden set and its suggestions. Experiments made with the old kind are no longer listed.
