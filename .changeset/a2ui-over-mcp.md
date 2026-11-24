---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Over MCP, a notebook can be drawn as an A2UI page.

`notebook-read` now also returns a notebook as A2UI 1.0 data, for an `a2ui://notebook` layout the MCP server publishes, so an MCP host that draws A2UI shows a compact page (where it stands, what it rests on, the options, what's open) instead of text. It uses A2UI's basic components only, so any A2UI renderer can draw it; other hosts get the text as before. Also: `notebook-tldr` no longer counts a note's timestamp as one of the notebook's numbers when checking a takeaway.
