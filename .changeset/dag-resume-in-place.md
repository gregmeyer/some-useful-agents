---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Resume an interrupted DAG run in place.

`executeAgentDag` accepts `options.resume`: given an existing run id, it reuses
that run's completed node executions (reloading their outputs), clears any
incomplete node rows, and continues from the first unfinished node instead of
starting over. This is the foundation for durable Temporal runs (B2) — on a
worker/activity retry the run picks up where it crashed. No behavior change for
normal runs. New `RunStore.clearIncompleteNodeExecutions`.
