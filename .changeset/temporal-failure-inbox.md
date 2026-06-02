---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Failed Temporal runs raise an inbox conversation.

A run that fails on a Temporal worker — or one orphaned because the dashboard
died mid-run — now opens a `run-failure` thread in the dashboard inbox (one per
run, deduped) so the triage agent notices instead of the failure dying silently.
Local in-process failures don't raise one (they're visible to whoever triggered
them) and operator-cancelled runs never do. The executor exposes a decoupled
`onRunFailure` hook; the dashboard wires it (and covers boot-time orphan-reaped
runs).
