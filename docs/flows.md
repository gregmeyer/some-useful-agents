# Flow control

Most agents are straight-line DAGs — "fetch then summarize then post." But real workflows branch, loop, and call into sub-agents. sua exposes flow control as first-class node types so the YAML stays readable and the dashboard can visualize it.

This page covers every flow control node type + the `onlyIf` edge predicate. For the full YAML field list see [Agents reference](agents.md).

## `onlyIf` edges

Any node can declare an `onlyIf:` on one of its upstreams. When set, the node runs only if the predicate holds; otherwise it's skipped (not failed — skipped nodes don't fail the run).

```yaml
- id: fetch
  type: shell
  command: curl -s https://api.example.com/items

- id: process
  type: shell
  dependsOn: [fetch]
  onlyIf: { upstream: fetch, field: exit_code, equals: 0 }
  command: echo "Got data: $UPSTREAM_FETCH_RESULT"
```

The predicate object supports:

| Field | Shape | Meaning |
|---|---|---|
| `upstream` | string | Node id (must be in `dependsOn`) |
| `field` | string | Name in the upstream's output (JSON key or XML tag) |
| `equals` | any | Strict equality |
| `notEquals` | any | Strict inequality |
| `contains` | string | Substring match on string values |
| `greaterThan` | number | > |
| `lessThan` | number | < |

Only one comparison per predicate. For AND logic, use multiple `onlyIf` clauses on a `dependsOn` list — all must hold.

## `conditional`

Evaluates a predicate against an upstream's output and emits a boolean field (`matched`) that downstream nodes can branch on via `onlyIf`. Think of it as a "named branch point."

```yaml
- id: check
  type: conditional
  dependsOn: [fetch]
  conditionalConfig:
    predicate:
      field: status
      equals: 200

- id: success_path
  type: shell
  dependsOn: [check]
  onlyIf: { upstream: check, field: matched, equals: true }
  command: echo "Success"

- id: failure_path
  type: shell
  dependsOn: [check]
  onlyIf: { upstream: check, field: matched, notEquals: true }
  command: echo "Failed"
```

If `conditionalConfig.predicate` is omitted, sua infers it at save time by looking for an upstream field named `matched` / `ok` / `success` (warning in the dashboard if nothing fits).

## `switch`

Multi-way branch. The node reads a string field from its upstream and emits `selected_case = "<case-name>"`; downstream nodes filter via `onlyIf`.

```yaml
- id: classify
  type: switch
  dependsOn: [analyze]
  switchConfig:
    field: severity         # read from upstream.analyze.severity
    cases: [low, medium, high]
    defaultCase: low        # used when the value matches no case

- id: page_oncall
  type: shell
  dependsOn: [classify]
  onlyIf: { upstream: classify, field: selected_case, equals: "high" }
  command: ...

- id: open_ticket
  type: shell
  dependsOn: [classify]
  onlyIf: { upstream: classify, field: selected_case, equals: "medium" }
  command: ...

- id: log_and_move_on
  type: shell
  dependsOn: [classify]
  onlyIf: { upstream: classify, field: selected_case, equals: "low" }
  command: ...
```

## `loop`

Iterates a sub-agent over a list. The list comes from an upstream node's output (parsed JSON) or an agent input.

```yaml
- id: source
  type: shell
  tool: file-read
  toolInputs: { path: agents/examples/data/research-topics.json }

- id: research
  type: loop
  dependsOn: [source]
  loopConfig:
    over: topics              # JSON key in upstream.source.result
    agentId: two-step-digest  # sub-agent id to invoke per iteration
    maxIterations: 10         # safety cap
    inputMapping:             # map each item to sub-agent inputs
      TOPIC: "$item.title"
```

The sub-agent runs once per item; the loop's `result` is a JSON array of the sub-agent outputs. Downstream nodes get `{{upstream.research.result}}` with the array.

## `agent-invoke`

Calls another agent as a single sub-workflow (one run, not a loop). Useful for composing reusable pipelines.

```yaml
- id: analyze
  type: agent-invoke
  dependsOn: [fetch]
  agentInvokeConfig:
    agentId: agent-analyzer
    inputMapping:
      AGENT_YAML: "$upstream.fetch.result"
```

The sub-agent's run_id is captured in `invoked_run_id` on the node's output. The sub-agent's final result becomes the node's `result` so downstream nodes consume it like any other upstream.

## `branch`

A pure fork point — runs zero logic itself, but splits a single upstream into multiple downstream paths explicitly. Useful when you want several independent follow-on chains that all depend on the same source but don't need a conditional.

```yaml
- id: fetch
  type: shell
  command: ...

- id: fan-out
  type: branch
  dependsOn: [fetch]

- id: path_a
  type: shell
  dependsOn: [fan-out]
  command: ...

- id: path_b
  type: shell
  dependsOn: [fan-out]
  command: ...
```

The DAG could connect `path_a` and `path_b` directly to `fetch`; `branch` is there for readability and visualization purposes.

## `end` and `break`

`end` marks a terminal node — downstream-of-end paths are skipped and the run completes as soon as everything reachable from the root other than the end's descendants completes. Useful inside loops to stop early when a condition is met.

`break` is `end` inside a loop — halts the loop iteration early.

```yaml
- id: loop-over
  type: loop
  loopConfig:
    over: items
    agentId: try-fetch
    maxIterations: 10

- id: stop-on-first-success
  type: break
  dependsOn: [loop-over]
  onlyIf: { upstream: loop-over, field: any_matched, equals: true }
```

## Worked example — conditional-router

The bundled [`conditional-router`](../agents/examples/conditional-router.yaml) agent demonstrates the full pattern:

```yaml
id: conditional-router
name: Conditional Router
status: active
source: examples

inputs:
  INPUT_VALUE: { type: number, required: true, description: "Number to classify" }

nodes:
  - id: check
    type: conditional
    conditionalConfig:
      predicate: { field: INPUT_VALUE, greaterThan: 10 }

  - id: big
    type: shell
    dependsOn: [check]
    onlyIf: { upstream: check, field: matched, equals: true }
    command: echo "Big ($INPUT_VALUE > 10)"

  - id: small
    type: shell
    dependsOn: [check]
    onlyIf: { upstream: check, field: matched, notEquals: true }
    command: echo "Small ($INPUT_VALUE <= 10)"

  - id: done
    type: shell
    dependsOn: [big, small]
    command: echo "Classified"
```

Either `big` or `small` runs (never both). `done` runs after whichever-one-fired and prints a summary.

## Visualization

The dashboard renders every DAG as a Cytoscape graph at `/agents/<id>` → Overview tab. Flow-control nodes get distinct badges (branch, loop, agent-invoke, etc.). Skipped nodes render dimmed; failed nodes red.

## Related

- [Agents reference](agents.md) — the top-level YAML structure
- [Templating](templating.md) — `{{upstream.X.result}}` extraction for predicates
- [Examples directory](../agents/examples/) — `conditional-router.yaml`, `research-digest.yaml`, `daily-summary.yaml` all use flow control
