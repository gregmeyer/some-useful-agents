---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A Runbook page writes its runbook as the answer, never as a plan.

Asking sua to turn a notebook into a runbook could set its write step to write a plan of days, so Write again wrote a plan while the Runbook page still showed the old answer. A write step on a Runbook page now writes the answer, and sua is told a runbook is an answer.
