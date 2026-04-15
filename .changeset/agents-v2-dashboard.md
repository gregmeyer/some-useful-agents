---
"@some-useful-agents/dashboard": minor
"@some-useful-agents/core": patch
---

**feat: dashboard DAG visualization + per-node execution table (PR 5 of 5 for agents-as-DAGs).**

Completes the v0.13 user story: import your v1 YAML into DAG agents, run them, watch them in the dashboard with a real graph view and per-node logs.

### What ships

- **`/agents` page** splits into two tables: v2 "DAG agents" (from AgentStore) at the top, unmigrated v1 YAML agents below. An id that exists in both tables collapses to the v2 row; the v1 header only appears when there are v1-only agents to show.
- **`/agents/:id`** (v2 variant) renders the DAG visually via Cytoscape.js (client-rendered from a server-supplied `<script type="application/json">` payload). Nodes are round-rectangles colored by type (shell green / claude-code magenta) with edges pointing downstream. `<noscript>` fallback lists nodes textually. "Run now" dispatches to the DAG executor; community-shell DAGs require confirmation.
- **`/runs/:id`** gains a per-node execution table for DAG runs: status, error category, duration, exit code. The DAG viz renders here too, with nodes color-coded by their execution status (completed / failed / running / skipped / cancelled). Each row links to a per-node detail section with stderr and stdout. "Replayed from …" breadcrumb shown when present.
- **Static assets** served from `/assets/cytoscape.min.js` + `/assets/graph-render.js` with long-cache headers. Cytoscape is resolved from `node_modules` at startup; no CDN, no bundler.

### Files

- New: `packages/dashboard/src/routes/assets.ts`, `views/dag-view.ts`, `views/agent-detail-v2.ts`
- Modified: `context.ts` (adds AgentStore), `index.ts` (opens AgentStore via shared path), `routes/agents.ts` (v2-first lookup), `routes/run-now.ts` (dispatches to DAG executor for v2), `routes/runs.ts` (joins node_executions for v2 runs), `views/agents-list.ts` (two-table split), `views/run-detail.ts` (DAG + per-node table when v2)

### Design constraints preserved

- No CDN
- No bundler (cytoscape vendored through npm, served from node_modules)
- No framework (client JS = 2KB vanilla bootstrap)
- v2 tagged-template rendering for everything HTML

### Tests

8 new cases in `dashboard.test.ts`:
- v2 agents appear under a "DAG agents" header on `/agents`
- `/agents/:id` renders the Cytoscape JSON payload with correct nodes + edges
- v2 preferred over v1 when same id in both
- `/runs/:id` shows per-node table + DAG for v2 runs
- `/runs/:id` stays minimal for v1 runs (no per-node UI)
- Replayed-from breadcrumb renders when present
- `/assets/cytoscape.min.js` serves (~100KB+)
- `/assets/graph-render.js` serves with correct content-type

412 → 420 repo-wide.

### Manual verification

```bash
sua workflow import --apply
sua workflow run <agent-id>
sua dashboard start --port 3000
# /agents → DAG agents table
# /agents/<id> → DAG rendered + node list
# /runs/<id> → per-node table + DAG colored by node status
```

### Deferred to v0.14

- Drag-and-drop DAG editing (plan's v0.14 scope)
- Node inspector (edit secrets/inputs/env in UI)
- Version history view + diff + rollback in UI
- `/settings/*` tree (secrets / integrations / general)
- Version-aware DAG rendering (currently shows current_version's DAG for all runs; a follow-up can pull the exact version the run executed)
- `LocalProvider.submitDagRun` unification (MCP + scheduler still dispatch to v1 chain-executor — dashboard now dispatches DAG directly)
