---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New builtin tool + example agents for data visualization.

- **`csv-to-chart-json`** builtin — turns CSV (inline or file path) into the JSON shape `modern-graphics-generate-graphic` expects. Three shapes: `simple` (labels + values), `series` (labels + named series), `cohort` (date + size + values). CSV parser handles quoted fields and escaped quotes.
- **`graphics-creator-mcp`** example agent — topic + audience brief → modern-graphics theme creation → hero render → composite overlay. Demonstrates MCP tool chaining end-to-end.
- **`chart-creator-mcp`** example agent — CSV input → `csv-to-chart-json` → `modern-graphics-generate-graphic`. Supports all 22 chart layouts via enum dropdown.
