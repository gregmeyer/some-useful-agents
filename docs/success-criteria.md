# Agent success criteria + the agent loop

When an agent declares `successCriteria`, the runtime wraps its execution in an **agent loop**: after each DAG run, the listed criteria are checked, and if any fail the agent re-runs (up to `maxLoopIterations`) with a `LOOP_FEEDBACK` input carrying the failure list from the previous attempt.

This is **author-declared validation acceptance** — separate from the [`retry:`](retry.md) policy, which handles transient infrastructure failures like timeouts and exit-nonzero categories.

## Minimal example

```yaml
id: weather-summary
name: weather-summary
inputs:
  CITY:
    type: string
    default: Brooklyn
nodes:
  - id: fetch
    type: shell
    command: |
      curl -fsS "https://wttr.in/$CITY?format=j1" > /tmp/wx.json && cat /tmp/wx.json

successCriteria:
  - kind: shellExitZero
    nodeId: fetch
  - kind: jsonPathEquals
    nodeId: fetch
    path: current_condition.0.temp_C
    equals: "21"
maxLoopIterations: 2
```

If `fetch` returns a non-zero exit OR the JSON path doesn't match the expected temperature, the agent re-runs once more before giving up.

## Criterion kinds

Each kind is checked without an LLM call — fast, deterministic, free.

| `kind` | Required fields | Passes when |
| --- | --- | --- |
| `shellExitZero` | `nodeId` | target shell node completed with exit code 0 |
| `fileExists` | `pathTemplate` | path exists on disk (supports `{{inputs.X}}` expansion) |
| `jsonPathEquals` | `nodeId`, `path`, `equals` | target node's JSON output, dot-walked, deep-equals the value |
| `regexMatch` | `nodeId`, `pattern` | target node's stringified output matches the regex |

`jsonPathEquals` walks dotted paths including array indices: `items.0.name`, `summary.totals.passed`, etc. Returns `undefined` on miss, which won't `equals` anything except `undefined`.

## `LOOP_FEEDBACK` input

When `maxLoopIterations > 1` and the first iteration fails, the agent re-runs with an extra `LOOP_FEEDBACK` input containing the failure list. Agents opt in by referencing it:

- **claude-code** node: `{{inputs.LOOP_FEEDBACK}}` in the prompt
- **shell** node: `$LOOP_FEEDBACK` env var in the command

Iteration 1 gets the input set to an empty string, so no template-resolution drama for agents that always reference it.

## What gets persisted

Each iteration writes one row to `agent_memory`:

- `agent_id`, `root_run_id` (the first iteration's run id), `iteration` (1-indexed), `run_id` (this iteration's run id — equals `root_run_id` when `iteration = 1`)
- `inputs_json` — what got passed in (truncated to 8KB)
- `observations_json` — compact summary of per-node status + result preview (truncated)
- `eval_status` — `passed` | `failed` | `transient-error` | `no-criteria`
- `eval_failures_json` — full failure list when `eval_status = failed`

There's no UI for this yet — query the SQLite table directly to inspect. A dashboard surface is a future polish.

## When NOT to use this

- **Pure observation agents** (cron jobs that fetch data and store it; no "did it work" definition beyond exit code). The `retry:` policy already covers transient infra failures.
- **Agents whose criteria depend on real-time external state** that doesn't settle between iterations (re-running won't change the answer).
- **Agents where iteration cost matters** (each iteration is a fresh DAG run with its own LLM/HTTP costs).

When `successCriteria` is absent or empty, the runtime is a pure pass-through to the existing retry-wrapped executor — no behaviour change.
