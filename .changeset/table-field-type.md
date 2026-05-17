---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

First-class `table` field type for `dashboard` widgets — declare columns inline instead of writing `<table>` markup in an ai-template.

A `table` field reads a top-level JSON array from the run output and renders a row-per-item HTML table over it. Columns are declared as `[{ name, label?, format?, href?, text? }]`; `format: link` columns wrap the cell in `<a href>` driven by `href` (per-row JSON key holding the URL) and `text` (per-row key OR literal label fallback like `"Apply →"`). Empty / missing arrays still render the header row plus a "No rows" caption so the column structure stays visible.

Sort / filter / paginate `WidgetControl`s attach by sharing the field's `name` — same grammar and per-field URL state (`?ws_<field>=`, `?wf_<field>=`, `?wp_<field>=`) as ai-template widgets. Discovery catalog updated with the new field type, schema, and a complete example. Editor preview synthesises three sample rows so authors can see the column layout immediately.
