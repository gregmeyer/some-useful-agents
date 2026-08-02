---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

feat(home): craft pass on the cadence feed — dense, typographic, alive

The home feed traded three outlined boxes for one dense, borderless list per
DESIGN.md ("typography and whitespace do the work"). Mono-caps hairline labels
are the only dividers; every row is the same grid so title / preview / meta /
age align into a right-hand ledger. Each row now shows a one-line preview of
its latest reply (or a "▸ N proposed actions" hint), so the feed reads as a
living conversation instead of dead titles. The toy emoji nature chips are
replaced by a quiet mono micro-label (`sched·llm`), needs-you is an amber
left-accent row instead of a filled box, empty "New conversation" stubs are
suppressed, the redundant top-bar pill is hidden on home, and new rows fade in
when the live feed updates.
