---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Planner refactor PR 4 — generated agents can declare `successCriteria` and run inside an eval loop.

Closes the 4-PR planner refactor. After PRs 1-3 brought the loop/eval/memory model to the planner itself, this PR extends the same shape to every agent: when an agent declares `successCriteria`, its execution is wrapped in `AgentLoopRunner`, which re-runs the DAG (up to `maxLoopIterations`) with prior-iteration eval feedback in `LOOP_FEEDBACK` until either eval passes or the budget is exhausted.

**Schema additions** (both optional; absence = single-shot pass-through, no behaviour change for existing agents):
- `successCriteria: [Criterion]` — discriminated union of `shellExitZero` / `fileExists` / `jsonPathEquals` / `regexMatch`.
- `maxLoopIterations: 1..5` — defaults to 1 (criteria evaluated but no retry on failure). Explicit opt-in (≥2) required for retry behaviour.

**Wiring**:
- `LocalScheduler.v2Deps` accepts `agentMemoryStore`; scheduled fires go through `executeAgentLoop`.
- Dashboard `run-mutations` route (manual retry) routes through `executeAgentLoop`.
- CLI `sua schedule start` instantiates `AgentMemoryStore` and threads it in.

**Each iteration writes one row to `agent_memory`** (root_run_id + iteration as the grouping key), capturing inputs / observations / eval status / failure list.

**`LOOP_FEEDBACK`** input is automatically populated on iteration 2+; iteration 1 sees an empty string. Agents opt in by referencing `{{inputs.LOOP_FEEDBACK}}` (claude-code) or `$LOOP_FEEDBACK` (shell).

30 new tests (20 eval-criteria + 3 memory-store + 7 runner). Docs added at `docs/success-criteria.md`. Total of 1420 passing across the 4-PR refactor.
