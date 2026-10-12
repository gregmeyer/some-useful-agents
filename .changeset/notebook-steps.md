---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook can lay out its work as steps: find, source, check, decide.

A notebook's steps (`steps_json`) list its work in order, each with a kind, the agent that works on it and an optional target. The notebook checks each step's goal itself, with no model (`stepProgress`). Find means enough options in the running, source means every option has its tracked facts, check means every option has each check ticked, and decide means you've confirmed the final set. The notebook page shows the steps with their progress ("8 of 10 found") in place of the pipeline diagram. Set them with `POST /notebooks/:id/steps`. Running steps comes next.
