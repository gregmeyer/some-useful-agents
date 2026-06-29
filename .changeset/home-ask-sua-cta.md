---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Home: replace the leftover header buttons with an inbox-first "Ask sua" CTA.

The unified home had three competing action clusters in the upper-right — the old
"Build from goal" / "Browse packs" header buttons, the Needs-you strip's "Open
inbox", and the board's own controls. The header buttons (carried over from the
stat-only home) are replaced by a single primary **Ask sua →** that opens a fresh
inbox thread, aligning the home's primary action with its inbox-anchored layout.
Build-from-goal still lives on /agents and the no-agents empty state.
