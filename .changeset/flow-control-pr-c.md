---
"@some-useful-agents/core": minor
---

**feat: agent-invoke node type + nested runs (Flow PR C).**

An `agent-invoke` node runs another agent as a nested sub-flow. The sub-agent gets its own `runs` row linked to the parent via `parent_run_id` + `parent_node_id`. The parent node waits for the sub-run to complete and captures its result as structured output.

- **Recursive `executeAgentDag`** — the executor calls itself with the sub-agent's definition, threading `parentRunId`/`parentNodeId` so the audit trail is complete.
- **`AgentStore` on `DagExecutorDeps`** — required for resolving sub-agents by id. Fails cleanly when absent or when the sub-agent isn't found.
- **Input mapping** — `agentInvokeConfig.inputMapping` maps upstream outputs to sub-agent inputs. Supports `upstream.<id>.<field>` path expressions.
- **Parent node result** = sub-run's final result. Sub-run failure propagates as parent node failure with `setup` category.
