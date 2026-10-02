---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Pulse and dashboards are canvases: each board is one A2UI surface you arrange.

Pulse (`/pulse`) and every named dashboard (`/dashboards/<id>`) are now drawn as a single A2UI canvas: titled sections, responsive grids, rows, tabs and cards, with every agent's tile drawn inside by its own view. Run (or the agent's own form) runs in place and refreshes only that tile; ⚙ configures it and × hides it from Pulse. Pulse shows what you've placed first, then everything else in tabs by recent use. **✨ Suggest a layout** asks the layout planner for an arrangement that opens as unsaved changes. Layouts are stored by the dashboard (the same in every browser), versioned, and undoable; **Save as pack** exports the canvas, each section or tab becoming a pack section. The A2UI catalog gains five board-only components (`Section`, `Grid`, `Cell`, `AgentTile`, `SystemTile`) that agent views can't use. The previous layout is one switch away for this release: Settings → Appearance → Show Pulse and dashboards as boards.
