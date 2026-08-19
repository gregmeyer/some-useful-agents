---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Creating an agent now lands you on the agent, not on "add another node".

`POST /agents/new` redirected to `/agents/:id/add-node?fromCreate=1` — a screen
about chaining a *second* node, shown before you had ever run the first one.
That put DAG composition in front of "does this thing work?", which is
backwards for anyone new: the payoff for creating an agent is running it.

It now redirects to the agent's own page, where **Run now** is, with a flash
reading "Created. Run it to see what it does." Adding nodes stays one click
away on the Nodes tab.
