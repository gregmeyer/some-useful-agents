---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents arrange boards: `board-read` and `board-place` tools, also over MCP.

`board-read` returns a board as an outline of its sections, tabs, rows, grids and tiles, each with its id, plus a short brand guide; `board-place` takes the same operations as the Arrange editor (`insert`, `move`, `remove`, `wrap`, `unwrap`, `set`, `span`), checked and saved together as an undoable version (a stale version, an unknown id or an uninstalled agent changes nothing). Claude Desktop and other MCP clients get the same two tools, and the tool policy applies with the board id as the resource, so a rule can keep agents off Pulse.
