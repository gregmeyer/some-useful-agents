---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

feat(home): hero chat composer — type on the front door, sua answers live

The "Ask sua" button on the home front door is now a real inline chat input: a
mono `sua ›` prompt with an auto-growing textarea (Enter sends, Shift+Enter
newlines, teal focus ring). Typing a message opens the thread in place with the
triage agent already streaming its answer — the front door is the conversation.

`POST /inbox/new` now accepts an optional first message: when present it seeds
the thread's first user message, derives the title from it, and fires triage
immediately (instead of creating an empty "New conversation" stub). Without a
body the old behavior is unchanged. Degrades to a normal POST→redirect without
JS. This also stops the front door from ever manufacturing empty stubs.
