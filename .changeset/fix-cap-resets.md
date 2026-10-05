---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A long conversation about an agent no longer runs out of changes.

sua stops applying fixes on its own after three changes to one agent that never got it working. That count used to cover the whole conversation, so once a conversation had made three changes to an agent, every later request to change it was refused, even after the agent was running fine.

The count now starts over:
- when the agent runs successfully in the conversation, since later changes are new work rather than more of the same fix;
- when you answer sua's "stopping automatic fixes" note.

A plain "please fix it" still doesn't reset it, so a fix that keeps failing still stops after three tries. The note now says a reply will let sua keep going.
