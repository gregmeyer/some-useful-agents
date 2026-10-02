---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Canvas preview: a board drawn as one A2UI surface.

**Canvas preview** on any board (or `/boards/<id>/canvas`) draws Pulse or a dashboard as a single A2UI surface: sections, responsive grids and tabs, with each agent's tile drawn inside by its own view. Run, the agent's own forms, ⚙ configure and × hide work in place, and only the tile you ran refreshes. Five board-only components join the A2UI catalog (`Section`, `Grid`, `Cell`, `AgentTile`, `SystemTile`); agent views can't use them. Boards can now store a canvas document (validated strictly, versioned, undoable), which arranging a canvas will use next.
