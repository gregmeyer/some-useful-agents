---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Conversations show plainly when a reply is still being written.

"Working…" and "Writing…" now pulse. An agent's conversation opened mid-reply in the sua panel or on Home shows the reply so far and keeps streaming (it used to look finished), with the reply box saying "<agent> is replying…". Conversation list rows being answered show a pulsing dot and "sua is working…" / "<agent> is replying…". The Chats tab now includes conversations with agents. Also: a Table column may have an empty heading (a comparison's row-heading column), which used to stop the table from drawing.
