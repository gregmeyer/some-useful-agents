---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Agents can't be saved with a node reference that won't be filled in.

A step's prompt that says `{{nodes.cargurus}}`, `{{steps.cargurus}}` or `{{upstream.cargurus}}` (no `.result`) was saved without complaint, and the executor passed it through as literal text. A merge step written that way never saw its sources' results, so it reported 0 matches no matter what they found. Such references now fail validation with the right form (`{{upstream.cargurus.result}}`), so sua's builder and fixes correct them instead of saving them.
