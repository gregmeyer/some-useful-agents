---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Set "keep going if this step fails" from the dashboard.

A step's Edit page now has a **Keep going if this step fails** box (the node's `optional` flag) on any step another step depends on. Ticked, a failed step no longer stops the run: the steps after it get a short note in place of its output. Before, this could only be set in the agent's YAML or by sua's builder.
