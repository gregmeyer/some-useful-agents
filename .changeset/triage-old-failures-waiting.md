---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

sua doesn't lead with old failures, and says when an action waits for you.

In a conversation, each failed or refused action sua reads now says how long ago it happened and whether it came before your latest message; so does the focus agent's last failed run. sua is told to answer what you asked now and never to open with an earlier failure. When it proposes an action that doesn't start on its own, its reply says to press Run and its chip reads "waiting for you: …" instead of sounding as if the work had begun.
