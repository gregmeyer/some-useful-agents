---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

AI-generated output widget templates.

New `ai-template` widget type: describe the layout in plain English, Claude generates an HTML template, we sanitize and reuse it for every run. Fields can be referenced via `{{outputs.NAME}}` and the raw output via `{{result}}`; values are HTML-escaped before substitution and the rendered result is run back through the sanitizer at render time (defense-in-depth).

**Abstracted LLM provider** so Codex/Gemini/etc. can plug in via `registerTemplateGenerator()` without route changes. Ships with Claude (`claudeTemplateGenerator`) by default, spawning the local `claude --print` binary with a strict system prompt.

**Pure tag/attribute allowlist sanitizer** (`sanitizeHtml`, zero deps). Strips `<script>`, `<iframe>`, `<form>`, `on*` handlers, `javascript:`/`vbscript:` URLs, and non-image `data:` URLs. Preserves SVG with its cased attributes (`viewBox`, `gradientUnits`, etc.) so generators can emit inline charts.

**UX:** Generate click opens a modal with a spinner, elapsed-seconds counter, and a Cancel button wired through `AbortController` + `req.close` so Claude is actually killed on cancel.

New exports from core: `sanitizeHtml`, `substitutePlaceholders`, `claudeTemplateGenerator`, `getTemplateGenerator`, `listTemplateGenerators`, `registerTemplateGenerator`.
