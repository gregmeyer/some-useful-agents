---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
---

**feat: v1 → v2 migration + `sua workflow` CLI + replay-from-node (PR 4 of 5 for agents-as-DAGs).**

This PR wires everything from PRs 1–3 together into user-facing functionality. Users can now import their v1 YAML chains, see the merged DAGs, run them, inspect per-node logs, and replay from a specific node — all via the new `sua workflow` command tree.

### Migration (`agent-migration.ts` in core)

- `planMigration(inputs)` — pure function, no filesystem reads; takes the v1 agent set, builds transitive `dependsOn` closures, emits one DAG-agent per connected component. Idempotent.
- `applyMigration(plan, store)` — upserts into `AgentStore` with `createdBy: 'import'`. Leaf of the component becomes the DAG's id. `{{outputs.X.result}}` rewritten to `{{upstream.X.result}}`. `.yaml.disabled` files (v0.11's paused state) map to `status: 'paused'`.
- Defensive rejections: mixed-source components (e.g. local depending on community) refused with a clear warning; fan-out components with multiple leaves emit an advisory and pick the alpha-first leaf; missing `dependsOn` targets flagged.
- 14 new tests covering isolated agents, linear chains, diamonds, fan-outs, mixed-source refusal, template rewrite, idempotent re-runs, version bumps on DAG changes, commit-message preservation.

### `sua workflow` CLI command tree

| Verb | What it does |
|---|---|
| `import [dir] [--apply]` | Dry-run by default; `--apply` commits migration to the DB |
| `list [--status <s>] [--source <s>]` | Table of imported DAG agents |
| `show <id> [--format yaml]` | Text DAG view or full YAML export |
| `run <id> [--input KEY=value] [--allow-untrusted-shell <id>]` | Execute synchronously via DAG executor |
| `status <id> <status>` | active / paused / archived / draft |
| `logs <runId> [--node <id>] [--category <cat>]` | Per-node execution table with category filter |
| `replay <runId> --from <nodeId>` | Re-run from the pivot, reusing stored upstream outputs |
| `export <id>` | Emit YAML to stdout (round-trips with `import-yaml`) |
| `import-yaml <file>` | Ingest a v2 YAML file directly (bypasses v1 migration) |

Run id prefixes work for `logs`/`replay`. Every command shares a single `DatabaseSync` connection via `AgentStore.fromHandle` + `RunStore.fromHandle`.

### Replay-from-node (new executor mode)

`executeAgentDag(agent, { replayFrom: { priorRunId, fromNodeId } })`:

- Copies prior `node_executions` rows for every node before the pivot in topological order, preserving their `result`, `started_at`, and `completed_at`. The audit trail makes clear these are historical, not fresh.
- Seeds the executor's outputs map with copied results, so the pivot node sees exactly the upstream snapshot the original run produced.
- Re-executes the pivot and all downstream nodes fresh.
- `runs.replayed_from_run_id` + `replayed_from_node_id` populated for the UI breadcrumb.
- Refuses the replay if the pivot isn't in the agent or if any pre-pivot node in the prior run lacks a completed result — fail-fast setup-category error rather than running the pivot with empty upstream.

4 new replay tests: copy behavior, upstream snapshot preservation at pivot, pivot-not-in-agent refusal, missing-prior-outputs refusal.

### Tests

18 new (14 migration + 4 replay). 394 → 412 repo-wide.

### What's NOT in this PR (landing in PR 4b before PR 5)

- `LocalProvider.submitDagRun` — today `sua workflow run` calls the DAG executor directly. MCP and scheduler still dispatch to v1 agents via `LocalProvider.submitRun`. PR 4b adds dispatch so all three triggers (CLI, MCP, cron) route through the same DAG executor.
- Removal of `chain-executor.ts` — stays alive until the LocalProvider swap is complete.
- `@deprecated` markers on v1 `AgentDefinition` — paired with the swap.

Dashboard DAG visualisation is PR 5.

### Manual verification

```bash
cd /tmp && mkdir play && cd play
sua init
cat > agents/local/fetch.yaml <<EOF
name: fetch
type: shell
command: "echo headlines"
source: local
EOF
cat > agents/local/summarize.yaml <<EOF
name: summarize
type: shell
command: "echo got=\$UPSTREAM_FETCH_RESULT"
source: local
dependsOn: [fetch]
EOF
sua workflow import --apply         # merges into one DAG named 'summarize'
sua workflow list                   # shows fetch + summarize as a 2-node DAG
sua workflow show summarize         # DAG topology as text
sua workflow run summarize          # runs fetch → summarize; output: got=headlines
sua workflow logs <runId>           # per-node table with categorised errors
sua workflow replay <runId> --from summarize   # re-runs summarize with fetch's stored output
sua workflow export summarize       # emits YAML
sua workflow status summarize paused
```
