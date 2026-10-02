---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents arrange canvas boards: board-read gives an outline, board-place takes tree operations.

`board-read` now returns a board as an outline of its sections, tabs, rows, grids and tiles, each with its id, and `board-place` takes the same operations as the Arrange editor (`insert`, `move`, `remove`, `wrap`, `unwrap`, `set`, `span`), checked and saved together as an undoable version. An agent, or Claude Desktop over MCP, can now build sections, turn them into tabs, size tiles and add new ones. The earlier grid-style changes (`add`/`move` by x/y) are replaced.
