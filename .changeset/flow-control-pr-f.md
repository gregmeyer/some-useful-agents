---
"@some-useful-agents/core": minor
"@some-useful-agents/dashboard": patch
---

**feat: branch (merge) node + dashboard viz shapes (Flow PR F — closes flow control).**

Final flow-control PR. Adds the `branch` merge-point node and distinct Cytoscape shapes for all control-flow node types.

- **`branch` node**: explicit fan-in merge point. Collects all upstream outputs into `{ merged: Record<string, unknown>, count: number }`. Condition-skipped upstreams are excluded gracefully (the branch always runs, even if some paths were skipped). Bypasses the condition_not_met cascade that would otherwise skip downstream nodes with a skipped dependency.
- **Dashboard viz shapes**: conditional/switch = diamond, loop = round-octagon, agent-invoke = barrel, branch = round-pentagon, end/break = octagon. Each control-flow type also has a distinct color tint so the DAG at a glance shows where routing happens vs where execution happens.

### Flow control is complete

With PRs A–F, agent flows now support:
- `conditional` — if/else predicate evaluation
- `switch` — multi-case routing
- `loop` — iterate over arrays with sub-agent invocation
- `agent-invoke` — nested sub-flows with parent-child run linking
- `branch` — explicit fan-in merge
- `end` — clean early termination
- `break` — exit current loop iteration
- `onlyIf` — edge-level conditional execution on any node
