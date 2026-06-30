---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Refine the top-bar "needs you" badge + a readability/sizing pass on Home & Pulse.

The global "needs you" toast is now a crafted, right-anchored pill: a soft-amber
fill with a 1px amber border, a mono count, and a gently pulsing dot
(reduced-motion-safe), grouped with the theme toggle in a `.topbar__right`
cluster so it hugs the right edge instead of floating mid-bar. The label now
pluralizes ("1 needs your reply" / "3 need your reply") and the toast announces
via `aria-live`.

Alongside it, a full readability/sizing pass across the dashboard: a new
`--font-size-2xl` (28px) token plus reusable `.section-label` and `.stat-value`
utilities, then every hardcoded `font-size` (the 7-12px label soup, the off-scale
32px stats) and off-grid padding/margin in the stylesheets and view templates
remapped onto the design tokens — Home, Pulse, Inbox (list/detail/modal), agent
detail, nodes, and the output widgets. Only intentional values are left raw (the
16px rem anchor, optical 1px nudges, relative `em` units).
