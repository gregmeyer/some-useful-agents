---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A board's tile can run another tile beside it, and a table's rows can be clicked to run an agent.

A `Table` in a view takes `rowAction: { name: run-agent, agent?, inputs: { INPUT: row field } }`: clicking a row runs the agent with each input read from that row (a scoreboard row sends its league and game link to the game-details agent). On a board, a run action (a Button's or a row's) may name another agent placed on the same board; that tile runs with the values and refreshes in place. Anywhere else, and for an agent not on the board, the action still runs the view's own agent, as before (ADR-0047 amendment).
