---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's header follows its steps live, and a restart no longer strands a running step.

The notebook page now updates its header when a step starts, pauses or gets a new card from the conversation, so the buttons there always match the card waiting in the conversation. Before, starting a step from the conversation left the header showing Next step until you reloaded. A step that was running when sua restarted is now stopped there ("stopped by a restart"), keeping what it found, with Try again and Move on waiting, instead of reading as running forever.
