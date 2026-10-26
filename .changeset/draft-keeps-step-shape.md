---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

Starting a notebook from its draft keeps what each step does.

**Looks right, start it** used to drop a write step's shape, so a question notebook wrote talking points instead of the answer (and a plan notebook too). It also dropped a profile step's subject and a source step's facts, because the steps were saved before the fields they name. All three now carry through. Checks on a draft can be as long as on the notebook (120 characters), and a long one, like any draft phrase, ends at a word instead of mid-word.
