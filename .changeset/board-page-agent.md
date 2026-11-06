---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A board decides its own page, and you can pick how it looks.

Once a board built from a request has run its tiles, the new `board-page` agent reads what the board is for and what its agents' results hold (their fields, never their values) and keeps the grid, takes the front page, or composes a page that fits (ADR-0070). "How it looks" under the board's toolbar offers Grid, Front page, Let sua pick, and the page sua made for it; each is saved as a new version of the board (Undo last save puts it back). Asking sua from a board in words ("make it read like a newspaper") proposes a `board-page` card whose Compose has the agent draw the page as asked. Pulse keeps its grid.
