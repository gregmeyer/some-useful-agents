---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Agent output cards show a value's links and bold instead of raw Markdown.

An `ai-template` widget's `{{…}}` placeholder in text now draws the value's inline Markdown: `[label](url)` becomes a link that opens in a new tab, and `**bold**`, `*em*` and `` `code` `` are drawn. A "Worked out" card's answer with a source link now shows the link. A placeholder in an attribute, or inside `<a>`, `<code>`, `<pre>` or `<textarea>`, is still the plain escaped value, and the result is still sanitized. This applies wherever these cards draw: conversation threads, run detail, Pulse and the A2UI path.
