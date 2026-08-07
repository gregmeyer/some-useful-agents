---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New `web-fetch` builtin tool — free, local web-page retrieval for agents.

Give it a URL; it returns clean, readable Markdown optimized for an LLM (not raw
HTML). The harness owns the complexity: HTTP via native fetch with a browser-like
User-Agent and per-redirect SSRF re-validation, main-content extraction via
Readability + Turndown (dropping nav/scripts/boilerplate), and an optional
headless-browser fallback (Playwright, only when HTTP yields too little). It never
throws — every failure is a predictable structured result with a plain-English
`error` a small model can reason about.

Safety: http/https only, private/loopback/metadata IP blocking on every hop, and
caps on redirects, downloaded bytes, and extracted characters. Playwright is an
optional dependency (`npx playwright install chromium` to enable the browser
fallback); without it the tool stays HTTP-only and reports so. Appears on the
dashboard `/tools` page and is usable from any agent node via `tool: web-fetch`.
