---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Brand theme: one theme for the whole dashboard, every board and every tile.

Settings → Appearance → Brand sets the dashboard's theme for everyone: start from a preset (Default, Warm, Minimal, Neon, Editorial Paper), then change the colours for dark and light mode, the fonts, corner radius and the tile accent colours. It's stored in `.sua/theme.json` (versioned saves, Undo, Reset), served as `/assets/theme.css`, and reaches inside every canvas tile. Tile palettes and accents are now defined once as tokens instead of in several stylesheets. The per-browser widget themes become shared presets. Agents arranging boards get a short brand guide (style through tone, palette and accent names, never colours).
