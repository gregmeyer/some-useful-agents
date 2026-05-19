---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Make the Advanced LLM options disclosure on `/agents/new` visually prominent.

PR #301 added the disclosure but styled it `dim text-xs`, which made it nearly invisible to anyone scanning the form. Now it renders as a bordered card with a semibold summary, an inline secondary hint listing the four fields it expands, and a divider above the expanded content.
