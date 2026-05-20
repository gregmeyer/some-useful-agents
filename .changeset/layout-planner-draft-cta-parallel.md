---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The "Draft these agents" CTA now sits in the action row alongside Cancel and Apply layout, so all three choices are visible together: Cancel · Apply layout only · **Draft N agents + apply**. When the planner emits `needsNew[]`, Draft becomes the primary button (since the user explicitly asked for new agents) and Apply layout demotes to a ghost-style "skip drafting" escape hatch.
