---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

A car's VIN is one key, however an agent writes it.

A key that is just a VIN ("vin|…", "vin:…", "VIN …" or the bare 17 characters) is now kept in one form, so the same car from two runs or two agents is one option instead of two. A car kept under an older form is found and its key updated when it's seen again.
