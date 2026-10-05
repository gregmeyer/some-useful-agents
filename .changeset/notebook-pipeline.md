---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's pipeline fills it in (G2–G3).

**Run the pipeline now** on a notebook runs its agents in order, each given the notebook's goal in its goal-like inputs. After each one, the new **notebook keeper** agent reads what it found and writes what's new: options that fit the parameters, evidence, notes, and ruled-out decisions with the reason.
- **No repeats:** it skips what the notebook already has.
- **Criteria:** it ticks a criterion only when the output shows it's met, and says why.
- **Provenance:** each entry links to the agent and run it came from, and the page shows which agent is running and a summary of the last run.
