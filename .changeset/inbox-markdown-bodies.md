---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Render inbox message bodies as Markdown.

Triage, user, and system messages, the producer summary, and action rationale
now render through the Markdown pipeline (`renderMarkdownSafe`, wrapped in a
scoped `.inbox-md` container) instead of plain escaped text — bold, code,
lists, links, and headings display properly in conversations. Output is still
sanitized, so raw HTML stays inert.
