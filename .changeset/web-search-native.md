---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

`web-search` in a node's tools turns on the provider's own live search.

It used to be dropped without a word, so a step told to "search the web first" could only open pages it guessed. claude now gets WebSearch and codex its live web_search; a provider without live search is skipped, like any missing tool. A node asking for claude's `WebSearch` in allowedTools gets codex's search too.
