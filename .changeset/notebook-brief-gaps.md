---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's searches hear what it already has and which facts are still missing.

The notebook input a search agent gets (`GOAL`, `NOTEBOOK`, `NOTEBOOK_CONTEXT` or `BRIEF`) now lists the options in the running, so they aren't brought back, and for each the tracked facts it still lacks ("Motive — employees, revenue, founded"). An agent can then fill those gaps by name as well as find new options.
