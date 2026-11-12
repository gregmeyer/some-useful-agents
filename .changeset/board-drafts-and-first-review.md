---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A board's review can suggest drafting a new agent, and a built board arrives with its first review.

When a board's goal needs something none of your agents returns, "Improve this board" can suggest a new agent to draft. Taking it drafts the agent in the background and asks you once to approve it before anything is added, the same way a board build does. A board built from a request now gets sua's first review automatically, and the planner that picks its agents is told what each one returns (its latest fields and first line), not only its description.
