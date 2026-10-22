---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A list to research is one card in a conversation, not one per part.

Asked to check 13 companies, sua split them across two research-fanout cards (it stops at 12 unless told more), so there were two buttons to press for one request. sua is now told to send the whole list in one run and raise `MAX_ITEMS` past the default, and cards it still proposes for parts of one list (same agent, same ask, different items) are merged into one card for up to 20 items.
