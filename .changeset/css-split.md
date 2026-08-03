---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

refactor(dashboard): split the 4.2k-line screens.css into per-surface sheets

screens.css was a 4,180-line monolith. It's now six contiguous per-surface
sheets — shell, agent-detail, runs, settings, pulse, inbox — concatenated by
the assets router in the same source order. Pure mechanical move: no rule was
reordered, so the served /assets/dashboard.css is byte-identical to before
(zero visual change). Makes the CSS navigable and gives inbox.css a clean home
for the ongoing thread-modal work.
