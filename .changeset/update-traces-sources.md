---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Update all traces the source pages it found before writing the answer again.

An answer notebook's or write-up's Update all ran its Check only on new options, so the pages the update found were never traced and the answer was rewritten on unchecked sources. Its Check now traces the new pages, and any not traced yet, before Write again, and the step says how many are traced.
