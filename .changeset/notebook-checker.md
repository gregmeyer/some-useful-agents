---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua checks a notebook's options against its checks, and only ticks what a quote shows.

A check step with no agent uses `notebook-checker`, a new built-in agent. A model judges each option against each check that's still open, with a quote copied from the option's notes or a page it opened. Code then confirms the quote is there word for word. A confirmed "met" ticks the check, and a confirmed "not met" rules the option out with the quote as the reason. Anything unconfirmed stays open. An agent's own `<notebook>` block can now tick checks and rule options out through `facts: [{id, checked, ruleOut}]`; sua's keeper can't. Agents that declare `CHECKS` or `OPTIONS` inputs get the notebook's checks and its options in the running.
