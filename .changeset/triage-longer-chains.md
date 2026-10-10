---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

sua carries on longer between your replies.

In a conversation, sua now takes up to 12 turns in a row (was 5) and runs up to 24 actions (was 10) before pausing to ask you to reply, so multi-step work like find → source → check doesn't stop every few steps. Stop, and the guard that ends repeated fixes without a good run, still end a loop that isn't getting anywhere.
