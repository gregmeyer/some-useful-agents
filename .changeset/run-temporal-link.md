---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Link a run to its Temporal workflow.

The run detail page's Backend row now shows a "View in Temporal ↗" deep link for
runs that executed on Temporal, opening the run's `sua-run-<id>` workflow in the
Temporal Web UI (honoring the configured namespace). Local runs are unaffected.
