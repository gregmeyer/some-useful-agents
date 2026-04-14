---
"@some-useful-agents/core": minor
---

**feat: Agent v2 types + YAML schema + round-trip (PR 1 of 5 for agents-as-DAGs).**

Foundation work for the v0.13.0 "agent is a DAG of nodes" architecture. No runtime behavior change yet; nothing else in the repo consumes these types. Each subsequent PR in the series adds a layer:

- **This PR (v2 types + YAML):** `Agent`, `AgentNode`, `AgentVersion`, `NodeExecutionRecord` types; Zod schema for YAML v2; `parseAgent()` + `exportAgent()` round-trip
- **PR 2 (agent-store + run-store):** DB schema for `agents`, `agent_versions`, `node_executions`; CRUD
- **PR 3 (DAG executor):** topological walk, per-node record writes, trust-source propagation (lifted from `chain-executor`), `{{upstream.<nodeId>.result}}` template substitution
- **PR 4 (migration + CLI):** auto-merge v1 YAML chains into DAG-agents; `sua workflow` verbs
- **PR 5 (dashboard viz):** Cytoscape-rendered DAG on `/agents/:id`, per-node execution table on `/runs/:id`

### What's in this PR

- `Agent` / `AgentNode` / `AgentStatus` / `NodeOutput` / `NodeExecutionRecord` / `AgentVersion` types
- Zod schema with:
  - Unique node ids, valid `dependsOn` references, cycle detection
  - Template validation: `{{inputs.X}}` must be declared; `{{upstream.Y.result}}` must be a declared upstream node
  - Shell-command template rejection (same env-var convention as v1)
  - Sensitive-env input name shadowing rejection (reuses v1's `SENSITIVE_ENV_NAMES`)
  - Cron cap (reuses v1's `validateScheduleInterval`)
- `parseAgent(yaml): Agent` with a typed `AgentYamlParseError` carrying validation issues
- `exportAgent(agent): string` with stable key order for git-diff-friendly output
- `exportAgents(agents): Map<filename, yaml>` for dumping a whole workspace

36 new tests (24 schema + 12 YAML round-trip). 302 → 338 repo-wide.

### Why YAML stays a first-class concern

Per the v0.13 plan: DB is editable runtime state; YAML is the lossless serialization format for git, portability, and review. `parse(export(a)) ≈ a` for every valid `Agent` is a test invariant. Stable key order + omit-undefined-fields keeps diffs predictable.

### Template vocabulary recap

- `{{inputs.X}}` — agent-level caller-supplied input (caller passes `--input X=value`)
- `{{upstream.<nodeId>.result}}` — upstream node's stdout within this agent (claude-code only; shell nodes read `$UPSTREAM_<NODEID>_RESULT` env vars)
- `{{outputs.X.result}}` (v1 cross-agent) — removed. Migration in PR 4 rewrites these as `{{upstream.X.result}}` within merged agents.
