---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

A decided notebook still keeps what its agents find.

A run you approve in a decided (or stopped) notebook's conversation is now added to the notebook, as it was while active, and **Add to notebook** works on a decided notebook too, instead of saying "This notebook is closed. Reopen it under Edit". Only an archived notebook refuses. The "Runs not in this notebook yet" card no longer says those runs ran outside the conversation.
