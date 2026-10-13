---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

In a run's diagram, steps that haven't started are grey with a dashed edge.

They used to take their type's colour, so a shell step waiting its turn looked the same green as a finished one. This applies on the run page and on the Overview's live diagram; an agent's own diagram (no run) keeps its type colours.
