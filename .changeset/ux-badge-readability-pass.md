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

Alongside it, a small consistency pass on the surfaces you land on first: a new
`--font-size-2xl` (28px) token plus reusable `.section-label` and `.stat-value`
utilities, applied to the Pulse stat values (were an off-scale 32px) and the
Home activity widgets (replacing hardcoded 9-10px labels and off-grid padding).
