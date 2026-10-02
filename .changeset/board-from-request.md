---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build a board from a request: describe it, and sua picks your agents, lays it out, runs it, and tells you when it's ready.

**＋ New board** asks what the board should show. A new board-builder agent picks the agents you already have that answer it, groups and sizes them; sua lays out the canvas, runs every tile once, and posts "your board is ready" to the inbox, with any tile that failed and the parts of the request no agent covers yet. The board shows progress while it builds, so you can leave and come back. Inbox items from this use a new `board` source and aren't auto-triaged.
