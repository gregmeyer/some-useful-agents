---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Humanize node-run failures — no more bare `exit_nonzero`.

When a node in an agent run exited non-zero, the failure surfaced as jargon: a
run-level `Failed at node "X" (exit_nonzero)` string echoed verbatim in the
dashboard error banner, the inbox run-failure thread, and the CLI (`sua run`,
`sua status`). The exit code, its meaning, and the stderr all existed but were
never combined into one readable sentence.

A new shared explainer in core (`explainNodeFailure`) now turns a node failure
into one plain line — e.g. `Node "fetch" exited with code 127 (command not
found): curl: command not found` — combining the failing node, the exit code and
its common meaning, and the last line of stderr. The run-level error is built
from it at the source, so every surface (dashboard banner, inbox thread, and
CLI) reads the same clear explanation. The machine-readable `errorCategory` field
is unchanged, so retry policies and dashboard badges behave exactly as before.
The failure-category label map also gains the previously-missing `abandoned` and
`policy_denied` entries.
