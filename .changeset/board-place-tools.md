---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents can arrange boards: `board-read` / `board-place` tools (also over MCP), and Suggest a layout.

Two new built-in tools let an agent read a board (Pulse or a named dashboard) and add, move, resize or remove tiles on it. Changes are validated, refused if the board changed since the agent read it, saved as a version you can undo from the board page, and checked against your tool policy (the board id is the resource, so a rule can keep agents off Pulse). MCP clients such as Claude Desktop get the same two tools. On a board page, **✨ Suggest a layout** asks the layout planner for an arrangement and opens it in the editor for you to adjust and save.
