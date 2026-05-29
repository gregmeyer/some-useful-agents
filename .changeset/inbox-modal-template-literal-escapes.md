---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

fix(dashboard): escape backslashes inside INBOX_MODAL_JS template literal

PR #409's `extractRecommendationFromStream` used un-doubled backslash escapes
(`'\\'`, `'\n'`, `\s`) inside the `INBOX_MODAL_JS` backtick template literal.
Template processing collapsed each `\\` → `\` at module-load time, producing
invalid served JavaScript: `'\'` was an unterminated string and `'\n'`/`'\t'`/
`'\r'` placed literal control characters inside single-quoted strings. The
browser threw a parse error during the inline IIFE, so every click delegate
in the inbox modal layer silently failed to attach — chevron toggle, row →
modal click, rail collapse, suggest banner, copy button, new conversation,
modal close.

Doubled the backslashes in source so they survive template processing and
produce valid JS in the served output. No behavior change to the parser
itself.
