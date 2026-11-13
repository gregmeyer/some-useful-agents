---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An archived notebook stops.

Archiving a notebook, or running it again as a new one, only hid it: its steps could still be started from a tab left open or a card in its conversation, so the old notebook kept searching and checking beside the new one. Now a step that is running stops when the notebook is archived, its step buttons and cards are retired, and nothing starts until it is restored.
