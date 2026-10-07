---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

See how a notebook was made.

A notebook's **How it was made →** opens its Workflow: every run that filed into it, the runs those started (a sweep's calls to other agents), and what each left, drawn as one graph like a run's steps, with every box linking to its run. Run pages link back to the notebooks they (or the run that started them) filed into. A run another agent started is no longer offered under "Runs not in this notebook yet" or shown as a failed search of its own.
