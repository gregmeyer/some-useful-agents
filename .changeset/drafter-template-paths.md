---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Tighten the agent-drafter prompt with an explicit rule: ai-template placeholder paths are SINGLE LEVEL ONLY. The substituter supports `{{outputs.NAME}}` / `{{item.FIELD}}` but NOT nested paths like `{{outputs.featured_duel.title}}` or `{{item.away_pitcher.name}}`. The discovery catalog already documented this, but the drafter kept generating nested paths and the literals leaked into rendered tiles. The rule now lives in the drafter's own prompt with paired ✗/✓ examples and guidance to flatten nested outputs in a post-processing node.
