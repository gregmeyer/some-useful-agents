---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Steadier Pulse tests.

The Pulse edition tests no longer start real agent runs. A test stand-in for starting a run from Pulse records the start instead. That fixes a test that failed on fast machines and a run that outlived its test. Nothing changes for users.
