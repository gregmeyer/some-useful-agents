---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Tidier `/nodes` catalog page.

Cards are now collapsible (default collapsed), grouped by category (Execution / Control flow / Terminal), with a top toolbar that has a live filter (matches type, description, use-when, field names) plus collapse-all / expand-all buttons. Anchor chips at the top jump straight to a node type. Filter and per-card open state persist in sessionStorage so anchor clicks don't lose context.
