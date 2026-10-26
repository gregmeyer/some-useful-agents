---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

research-fanout: research a list without one long node timing out.

A new shared agent, `research-fanout`, researches a list of things (companies, options, or the angles of one question) by running each as its own small `research-one` run, three at a time, with sources and quotes for every answer. One that runs long or fails is listed as unfinished and the rest still come back. sua's agent builder and the agent analyzer now reach for it instead of one big research step or copies of the same step.
