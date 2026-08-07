---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New `web-scrape` builtin tool — structured data + raw HTML extraction.

The complement to `web-fetch`: where web-fetch returns readable prose, web-scrape
returns the machine layer — JSON-LD (schema.org products/offers/prices/articles),
page metadata (title, og/meta tags), and optionally the raw or browser-rendered
HTML. Use it when an agent needs data fields, not article text.

It reuses the entire web-fetch HTTP + SSRF + optional-browser stack, so it inherits
the same safety (http/https only, per-hop private-IP blocking, redirect/byte caps,
timeouts) and never throws — failures return a structured result with a
plain-English error. Under `render: auto` it renders the page in a headless browser
only when HTTP returns no JSON-LD (SPAs inject it via JS); no new dependencies.
Appears on the dashboard `/tools` page and is usable from any node via
`tool: web-scrape`.
