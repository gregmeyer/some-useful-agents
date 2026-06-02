---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Durable v2 DAG runs on Temporal (provider layer).

The Temporal provider gains `submitDagRun`, which runs a whole v2 DAG as one
durable `sua-run-<id>` workflow: a long worker activity (`runDagActivity`) runs
the existing executor against the shared store. If the worker crashes, Temporal
re-dispatches the activity and it resumes the run from the last completed node
(via `resume`). A failed agent returns normally and does NOT retry — only an
infra crash re-dispatches. Not yet wired into the dashboard run paths (next PR).
