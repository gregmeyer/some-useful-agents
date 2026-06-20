---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Refactor: split the leaf helpers out of the oversized inbox route file.

`packages/dashboard/src/routes/inbox.ts` had grown to 3217 lines. This is the first
of three behavior-preserving slices: the pure/leaf helpers move into four cohesive
sibling modules — `inbox-shared.ts` (http/util + shared constants + pure formatters),
`inbox-catalog.ts` (sub-agent allowlist/catalog/input-enrichment), `inbox-plan.ts`
(plan/action/link parsing + crash-recovery), and `inbox-widgets.ts` (thread view-data +
in-thread widget assembly). `inbox.ts` re-exports the moved symbols so nothing else
changes. No logic changes; full suite unchanged at 2018 pass / 3 skip. inbox.ts is now
2249 lines; the engine extraction + shim cleanup follow.
