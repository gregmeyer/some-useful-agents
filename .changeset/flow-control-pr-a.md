---
"@some-useful-agents/core": minor
---

**feat: flow control foundation — node types, onlyIf conditional edges, nested run support (Flow PR A).**

Lays the type + schema + executor foundation for control-flow primitives in agent flows. No new node type dispatch yet (conditional, switch, loop, etc. come in PRs B–E); this PR establishes the data layer and ships the `onlyIf` conditional edge feature end-to-end.

### What ships

- **Extended `NodeType` union**: `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break` join `shell` + `claude-code`. Control-flow types are first-class — the executor will dispatch to dedicated logic per type.
- **`onlyIf` on `AgentNode`**: edge-level conditional execution. Evaluates a predicate (`equals`, `notEquals`, `exists`) against an upstream node's structured output field before spawning. Skipped nodes get `condition_not_met` (not `upstream_failed`), which cascades to downstream nodes without triggering fail-fast.
- **Control-flow config interfaces**: `ConditionalConfig`, `SwitchConfig`, `LoopConfig`, `AgentInvokeConfig`, `endMessage` on AgentNode. Ready for PRs B–E to implement.
- **`condition_not_met` + `flow_ended`** error categories.
- **`parent_run_id` + `parent_node_id`** on runs table (idempotent migration). Ready for nested agent-invoke runs in PR C.
- **Zod schema** updated: accepts all new node types + `onlyIf` field. Control-flow nodes skip the command/prompt requirement.
- **If/else branching** works today: two downstream nodes with complementary `onlyIf` predicates — one runs, the other skips.

### Tests

527 total (521 → 527; +6 new):
- onlyIf.equals skips when no match / runs when match
- Cascading condition_not_met to downstream nodes
- onlyIf.notEquals
- onlyIf.exists (null = absent)
- If/else branching pattern (complementary predicates)
- All 521 existing tests pass unchanged (full backcompat)
