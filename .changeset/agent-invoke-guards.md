---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Agents that call other agents stop cleanly on a loop or a too-deep chain.

agent-invoke and loop steps now follow the same limits as agents used as tools. An agent can't call one that's already running higher up the chain (A → B → A), and calls go at most three levels deep. Both fail with a clear message instead of looping. Stopping a run now also stops the agents it called. When sua's edit card would make an agent call an agent that isn't installed, or itself, applying it is refused instead of failing later at run time.
