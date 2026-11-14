---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New experiment: search for the agent to test, and use a run's results as the set.

Setting up an experiment only listed notebooks to hold fixed, and tucked the agent being tested into a dropdown on the last step. Most of what there is to test with is in agents and their runs. There is now a step for **what you're testing**: your agents, the most run first, with run and version counts, and a search box; an agent that can't be handed the set says so. The set can be **the results of a run**: sua reads the list of items out of a run's output and shows every one before it is copied, leaving out the run's own scores and reasons. The notebook list has a search box that reaches archived notebooks. When you change the version of the agent, the page offers the versions the chosen agent actually has.
