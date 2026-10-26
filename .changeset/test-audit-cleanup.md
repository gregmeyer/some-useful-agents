---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

Tests that checked a copy of the code now check the code itself.

`sua agent reimport` and `sua outcome show` are tested through their own per-file and lookup code (which a reimport that can't read or parse a file, and a run-id prefix, now exercise), and the builder's "Install draft" proposal is tested by running it. No behavior changes.
