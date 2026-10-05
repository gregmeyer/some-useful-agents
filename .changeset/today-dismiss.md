---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Dismissing something on Today keeps it off Today.

An agent problem ("… is failing") is built from the agent's runs, so dismissing its conversation didn't remove it: it came straight back.
- **Dismiss button:** every item on Today now has **Dismiss**, in its pane and in the row's **⋯** menu, with Undo. It stays off Today until something new happens to it. A failing agent stays dismissed through more failures of the same streak, and comes back if it recovers and then fails again.
- **Conversations count:** dismissing an agent's failure or "Fix …" conversation also dismisses its problem.
- **Easier to find:** the row's **⋯** menu is now visible without hovering.
