---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Fix the "View in Temporal" deep link (no more 404).

Durable per-run executions now persist their Temporal execution runId
(`temporal_run_id`), so the run-detail "View in Temporal" link points at the
real history page (`/workflows/sua-run-<id>/<runId>/history`) instead of a bare
workflow id that 404s. Per-node Temporal runs (e.g. inbox-dispatched agents,
which have no single run-level workflow) now land on the namespace's workflows
list rather than a guessed `sua-run-<id>` that doesn't exist.
