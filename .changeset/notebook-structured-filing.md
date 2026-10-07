---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents can file into a notebook directly.

A run whose output contains a `<notebook>` JSON block (the shape sua's keeper writes: entries with facts, sources and estimates) is filed as is: no keeper model in between, no 12,000-character limit, and up to 50 entries per run. It's cleaned the same way, and the pass note says "(filed directly)". Anything else is read by the keeper as before.
