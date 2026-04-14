---
"@some-useful-agents/core": minor
---

**feat: DAG executor (PR 3 of 5 for agents-as-DAGs).**

Walks an Agent's nodes in topological order, writes one `node_executions` row per node, categorises every failure, and skips downstream nodes cleanly when an upstream fails.

Not yet wired into `LocalProvider.submitRun` — that swap lands in PR 4 alongside the v1 YAML migration + `sua workflow` CLI verbs. In this PR the executor is callable via `executeAgentDag(agent, options, deps)` but nothing ships a v2 Agent to it yet.

### What ships

- **`executeAgentDag(agent, opts, deps)`** — creates the parent `runs` row, walks nodes topologically, writes per-node records, rolls up final status. Returns the completed `Run`.
- **`topologicalSort(nodes)`** — Kahn's algorithm with declared-order tiebreaker. Deterministic output; defensive cycle-throw even though the v2 schema already rejects cycles.
- **`resolveUpstreamTemplate(text, snapshot)`** — substitutes `{{upstream.<nodeId>.result}}` refs and escapes `{{` inside the substituted value so the inputs resolver can't re-expand a second time (same defense as v1 chain-resolver).
- **`SpawnNodeFn`** injection point — production uses the built-in real spawner; tests provide canned responses without touching `spawn()`.

### Error categorization (per the plan's table, every row tested)

| Failure | `errorCategory` | Source |
|---|---|---|
| Secrets store missing / locked / missing secret | `setup` | pre-spawn `buildNodeEnv` throw |
| Missing required input at runtime | `setup` | pre-spawn resolve |
| Community shell agent not allow-listed | `setup` | pre-spawn gate |
| `spawn()` failed (ENOENT, EACCES) | `spawn_failure` | exit 127 or error event |
| Ran but exited non-zero | `exit_nonzero` | exit != 0 |
| Exceeded node timeout | `timeout` | exit 124 after SIGTERM |
| Upstream failed → this node never ran | `upstream_failed` | fail-fast short-circuit |

Categories with any non-completed status (failed / cancelled / skipped) are always populated; completed rows have `errorCategory: undefined`.

### Trust-source propagation (simplified from v1)

The v1 chain-executor wrapped community upstream output in `--- BEGIN UNTRUSTED INPUT ---` delimiters because cross-agent chains could mix trust levels. In v2 every node inside one agent shares the parent's `source` — no cross-agent output reaches a trusted node within a single DAG. What stays: the community-shell gate. A shell node inside a `source: community` agent refuses unless the whole agent is in `allowUntrustedShell`. Same error (`UntrustedCommunityShellError`), same allow-list semantics; granularity stays at the agent id.

### Env + secrets (per-node)

Each node spawns with its own env built from scratch:

1. `process.env` filtered by trust level (MINIMAL for community, LOCAL for local/examples)
2. Node's `envAllowlist` additions
3. Node's YAML `env:` values (with `{{inputs.X}}` + `{{upstream.X.result}}` templates resolved)
4. Node's **own** declared secrets from `secretsStore` — not shared across nodes
5. Agent-level inputs (caller-supplied + defaults; sensitive names blocked even if they slip past schema)
6. `UPSTREAM_<NODEID>_RESULT` env vars for each declared upstream

Logged inputs (`inputs_json` on `node_executions`) redact values for any key the node declared as a secret, so reading run logs doesn't leak credentials.

### Tests

27 new cases in `dag-executor.test.ts`. 367 → 394 repo-wide.

- Topological sort (ordering, diamond, cycle throw)
- Upstream template substitution (incl. the `{{` re-expansion defense)
- Single-node execution: success, exit_nonzero, timeout (124), spawn_failure (127)
- Multi-node DAG: topological execution order, upstream snapshot persistence, `UPSTREAM_*_RESULT` env injection, fail-fast + skipped downstream with `upstream_failed`
- Secrets: injection, log redaction, missing-secret → setup, no-store → setup
- Inputs: caller values, agent defaults, missing-required → setup
- Community shell gate: refused by default, allowed when allow-listed, claude-code bypass
- Env allowlist by trust level: community MINIMAL, local LOCAL

### What's NOT in this PR

- Replay-from-node (PR 4 — introduces new runs with copied upstream snapshots)
- LocalProvider wiring (PR 4 — v1 agents still dispatch through `chain-executor.ts`)
- Removal of `chain-executor.ts` (PR 4 — once nothing calls it)
- Dashboard DAG viz (PR 5)
