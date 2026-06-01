---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Run v2 DAG nodes on Temporal workers.

When the dashboard is started with `--provider temporal`, multi-node (v2 DAG)
agents now execute each node as a Temporal worker activity (one
`sua-node-<runId>-<nodeId>` workflow per node) instead of in-process. The
dashboard still orchestrates the DAG; node shell/LLM work is offloaded to the
worker, made cancellable (the activity heartbeats), and shown in the Temporal
UI. Runs and node executions are stamped `usedWorkflowProvider`.

Declared secrets are read on the worker from the secrets file and never travel
in the Temporal activity payload; non-declared sensitive env values are dropped
before crossing to the worker (a payload-encryption codec to lift that is a
planned follow-up). Durable whole-DAG-as-workflow orchestration is the next step.
