---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Today's reads on Home say what each agent found, not its label.

An agent's output is often a JSON object made for a tile, so its line on Home read "HN Top 5", "articles: 5 items" or "hero_name: Iron Fist". Now a short headline is followed by its summary or by the first thing it lists and how many more, and an output with no headline gives its summary, its first listed item, or what it names with its description. No agent has to change.
