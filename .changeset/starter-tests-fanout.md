---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Starter tests match starter-research on research-fanout.

The shipped-pack and Start-here tests still described starter-research's old two parallel gather nodes, so main's CI failed after #951. They now check that it hands its angles to research-fanout and that its code step prints the JSON its widget reads.
