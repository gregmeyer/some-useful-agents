---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A notebook remembers what happened in its conversation.

- **Search results reach the notebook.** Agents sua runs in a notebook's conversation now feed the notebook, like the pipeline does: what they find becomes options and evidence. A search that finds nothing leaves a note ("Searched Seattle Craigslist for Foresters: nothing that fits yet"), linked to its run.
- **Contradicting limits are replaced:** new limits that contradict old ones replace them instead of piling up.
- **New agents are offered for the pipeline:** when sua builds an agent for the notebook, it offers to add it to the pipeline.
- **The page shows sua's latest message** next to Continue the conversation.
