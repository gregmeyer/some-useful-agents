---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An experiment can run a whole notebook.

On New experiment, choose one of your notebooks in place of an agent. Every run is then a fresh copy of the notebook, taken through its steps with nobody pressing Continue, stopping before the step where you decide. You can change its limits and checks, the text of something you gave it, who does one of its steps (another agent, or an earlier version of the one it has), or the model. The experiment compares the options each copy is left with, the same way it compares agent runs.

Your notebook is not touched. Copies are kept, archived and marked with their experiment; they stay out of your notebook lists, have no conversation and raise nothing in your inbox, and each opens from the experiment's page. A pass makes 12 copies at most.
