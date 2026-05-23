---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Critic + drafter-prompt fix for broken Pulse tiles on drafted agents. Pulse renders a tile from `signal.template`, not `outputWidget.type` — so an agent that declares an `ai-template` outputWidget but sets `signal.template` to a named slot template (e.g. `text-image`) renders the empty slot template on the tile and the rich widget never shows. `critiquePlan` now flags this (outputWidget present + `signal.template !== 'widget'`) so the per-drafter retry self-corrects, and the drafter prompt spells out the rule with ✓/✗ examples.
