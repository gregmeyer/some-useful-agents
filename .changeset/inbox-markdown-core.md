---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add a zero-dependency Markdown renderer for chat/message bodies.

New `renderMarkdown` / `renderMarkdownSafe` helpers in core render the small
Markdown subset used in conversations (bold, italic, inline + fenced code,
links, lists, blockquotes, headings, soft line breaks). `renderMarkdownSafe`
composes the renderer with the existing HTML sanitizer as the trust boundary,
so output is safe to inline. This is the foundation for rendering inbox triage
messages as formatted text instead of plain escaped strings.
