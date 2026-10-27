---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

How a notebook was made, where you'll see it.

Under a notebook's steps, a line now says what made it ("Made by 6 agents in 39 runs · last 14m ago", who, and **See how it was made →**), and each step that has run has **How →**, opening How it was made on that step's latest pass. Passes keep the step they ran for (a new `step_id` on notebook passes) and are named for it ("Step 2 · Find 5 sources"); older ones are matched by their agent. Profile and write steps' runs, and their Look again / Write again, are recorded as passes too.
