---
"@some-useful-agents/core": minor
---

**feat: AgentStore + RunStore extensions (PR 2 of 5 for agents-as-DAGs).**

DB schema + CRUD for the v0.13 agents-as-DAGs architecture. No runtime consumers yet — the executor (PR 3) and migration/CLI (PR 4) are the consumers.

### `AgentStore`

CRUD over two new tables in the same SQLite file as `runs.db`:

- `agents` — mutable per-agent metadata (name, description, status, schedule, source, mcp exposure, `current_version` pointer, `provenance_json` for v0.15+ catalog tracking, timestamps).
- `agent_versions` — immutable DAG snapshots (nodes + agent-level inputs + author/tags). FK to `agents` with ON DELETE CASCADE.

```ts
const agent = store.createAgent({ id, name, status, source, mcp, nodes, ... }, 'cli');
// Every edit that changes the DAG = new version
const v2 = store.createNewVersion(id, updatedDag, 'dashboard', 'added retry');
// Metadata edits don't bump version
store.updateAgentMeta(id, { status: 'archived' });
// Rollback
store.setCurrentVersion(id, 1);
// List + filter
store.listAgents({ status: 'active', source: 'community' });
```

`upsertAgent` handles the idempotent import case: creates on first call, updates metadata if only metadata changed, creates a new version only when the DAG shape actually differs. Used by the v1 → v2 migration (PR 4) to stay idempotent across re-runs.

### `RunStore` extensions

- `runs` table gets four new nullable columns via idempotent migration: `workflow_id`, `workflow_version`, `replayed_from_run_id`, `replayed_from_node_id`. Pre-v0.13 rows stay valid; migration uses `PRAGMA table_info` to skip if already applied.
- New `node_executions` table keyed on `(runId, nodeId)` with FK cascade to `runs`. Persists per-node status, error, error category, results, resolved inputs, and the upstream output snapshot that fed the node (critical for replay-from-node).
- New CRUD: `createNodeExecution`, `updateNodeExecution` (partial patch), `getNodeExecution`, `listNodeExecutions(runId)` (startedAt ASC — topological order), `queryNodeExecutionsByCategory(category)` (drives `sua workflow logs --category=timeout` in PR 4).
- Partial index on `errorCategory` (where non-null) keeps category queries cheap.
- `Run` type gains optional `workflowId`, `workflowVersion`, `replayedFromRunId`, `replayedFromNodeId` fields.

### Shared-handle pattern

Both stores expose a static `fromHandle(db: DatabaseSync)` factory. Used by the CLI main process and the DAG executor so both stores share one connection to `runs.db` (avoids two handles on the same file). Stores created via `fromHandle` do not close the DB on `.close()` — ownership stays with whoever opened the handle. Path-based constructors are unchanged; existing callers (`LocalProvider`, dashboard, CLI status/logs/cancel) need zero changes.

### Tests

29 new cases: 22 AgentStore + 7 RunStore extensions including the legacy-DB migration test. 338 → 367 repo-wide.

### What's deliberately NOT here

- DAG executor (PR 3) — consumes `AgentStore.getAgent()` + `RunStore.createNodeExecution()`
- v1 YAML migration (PR 4) — uses `AgentStore.upsertAgent()` with `createdBy: 'import'`
- Dashboard DAG viz (PR 5)
