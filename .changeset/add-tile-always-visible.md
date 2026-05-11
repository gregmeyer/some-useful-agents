---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard: + Add tile button is always visible on /dashboards/:id

Previously the button was CSS-gated to edit mode, which made it
invisible to users who hadn't clicked Edit Layout first. Adding a
tile is non-destructive, so the gate was friction without payoff.
The button (and the empty-section "no tiles yet" hint) now show
without entering edit mode.
