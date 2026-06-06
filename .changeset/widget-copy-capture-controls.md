---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Output widgets: copy-to-clipboard and save-as-PNG controls.

Two new opt-in widget control types an agent can declare on its `outputWidget`:

- `copy` — a copy button (Material content_copy glyph + tooltip) that copies the
  rendered widget text to the clipboard.
- `capture-image` — a button that rasterizes the widget to a PNG and downloads it
  (html2canvas, vendored locally and lazy-loaded; CSP blocks CDN scripts). Optional
  `filename`. Note: external images that don't send CORS headers may capture blank —
  a browser security limit, surfaced as a clear message rather than a blank PNG.

Both are stateless, so they render in static contexts too (inbox inline widgets,
pulse/home tiles) — not just the run/agent detail pages. Configurable from the
output-widget editor's Controls section.
