---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The notebook keeper no longer fills in a price its instructions used as an example.

The keeper's instructions showed `"price": 4023` as an example. A run that found a bathroom cabinet with no price gave it $4,023. The examples are now placeholders, and the instructions say that every value must appear in the run's output, and that a price the output doesn't give stays out.
