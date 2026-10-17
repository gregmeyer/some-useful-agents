---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Notebook route tests wait for background passes before closing their stores.

Test-only: a notebook picture pass a route started could still be writing when the test closed its database, and the "database is not open" rejection failed CI.
