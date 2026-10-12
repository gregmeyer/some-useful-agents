---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A fix sua makes from a notebook no longer changes an agent other notebooks use.

When a fix proposed in a notebook's conversation targets a shared agent (one of sua's example agents, or one another notebook searches with), it's saved as a copy for that notebook, and that notebook switches to the copy; the original and every other notebook are left alone. The fix card says so before you approve it ("Save as a copy"). A fix asked for from the agent's own page still changes the agent itself.
