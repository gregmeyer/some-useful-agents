---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

Check (or source) just the top options when a step couldn't do them all.

A check or source step you moved on from short, or one that got stuck, now offers "Check the top 5 →" (or "Source the top 10 →"). It works on that step again for only the best options in the running: the step's goal becomes those, and its agent or sua's checker is given only them. N comes from your decide or narrow step's target, else 5. Steps keep this as `top`.
