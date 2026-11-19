---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

An answer's find step counts the sources it found.

A notebook that writes an answer gathers sources, often filed as evidence rather than options, but its find step counted only options, so one that found 12 explaining sources said "0 of 8 found" and moved on short. Each page filed as evidence now counts toward the goal, once per page.
