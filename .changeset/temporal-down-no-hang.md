---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A Temporal server that's down no longer hangs sua's replies.

When the dashboard hands a node to Temporal and the server refuses the connection, or doesn't accept the node within 10 seconds, the node runs in the dashboard instead (for the next 60 seconds, nodes skip Temporal). A node that starts on the server later is cancelled so it doesn't run twice. A run that hits its wall-clock timeout or is cancelled now stops 5 seconds after, instead of waiting on Temporal: sua replies with a 60s timeout had been waiting 3 to 7 minutes on an unreachable server before saying they couldn't answer.
