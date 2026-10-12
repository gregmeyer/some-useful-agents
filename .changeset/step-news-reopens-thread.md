---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook step's news reopens its dismissed conversation.

When a step finished or stopped short, sua posted its message and its Continue / Move on / Try again cards into the notebook's conversation even if that conversation had been dismissed or resolved, so they never showed up under "need your reply". The thread now goes back to waiting on you, the same way it does when you write from the notebook. An open thread keeps its status.
