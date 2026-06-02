---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Route run-now through durable Temporal runs, with a per-agent backend control.

Under `--provider temporal`, a v2 agent's run-now now submits a durable
`sua-run-<id>` workflow (crash-survivable, resumes from the last completed node)
instead of running in-process. A new per-agent `runOn` field (Agent config →
"Execution backend": local / temporal / default) decides: `local` opts out,
`temporal` or unset runs durably under a Temporal provider. Non-temporal
providers always run local. Inline sub-flows stay in-process.

This completes the B2 line: v2 DAG runs are durable end to end.
