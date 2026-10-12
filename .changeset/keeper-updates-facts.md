---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

A run's figures for options a notebook already has go onto those options.

When an agent that doesn't write the notebook's own format (an enrichment returning its own JSON, say) reports revenue, headcount or founding year for companies the notebook already has, sua's keeper now puts them on those options' facts, with source and estimate marks, instead of filing them as evidence. The keeper is given every option's id to do this. Numbers that aren't in the run's output are still left out, and the run's note says how many options were updated.
