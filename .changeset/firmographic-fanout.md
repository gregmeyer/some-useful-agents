---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

firmographic-research researches each company on its own, three at a time.

It used to research every company in one node, which timed out on ten. Now each company is its own small run through research-fanout, code builds the records from what was found (so the summing-up step can't change a fact), and companies that didn't finish are listed to run again. Ten companies that used to time out finish in under two minutes.
