---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix a notebook's conversation filling with "Start the next step" cards.

When a step added in front of steps already done reached its goal, its card offered the next step by position (one already done), the notebook retired it as moved on, and posted it again each time the page checked: a long row of identical cards. A finished step now offers the next step still to do (none when that's yours, like Decide), and a step card the notebook would retire at once is never posted.
