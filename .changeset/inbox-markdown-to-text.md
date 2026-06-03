---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add markdownToText for clean one-line previews.

New `markdownToText` helper in core reduces Markdown to single-line plain text —
unwrapping links to their label, dropping emphasis/code/heading/list/quote
markers, and collapsing whitespace. Foundation for de-noising the `/inbox`
list-row previews (which currently show raw Markdown syntax).
