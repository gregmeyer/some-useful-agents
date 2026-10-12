---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/dashboard": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
---

Notebooks with steps stop showing stages moved by hand.

On a notebook with steps, shortlist cards and option pages no longer show the stage chip ("Found") or the "Verified →" button, the stage filter and table column go, and ruled-out options drop "at Found". The steps already say how far each option got, and those stages had stopped meaning anything. OptionGrid takes `stageChips: false` for this.
