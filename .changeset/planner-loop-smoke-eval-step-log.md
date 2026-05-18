---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Planner refactor PR 2 — smoke-run eval + structured step log.

After PR 1 named the planner's loop phases, this PR makes "validated, not just produced" real:

- **`smokeRunNewAgents(plan, ctx)`** — runs `parseAgent` on each newAgent then a per-agent `validateOnly()` that catches runtime gotchas the structural critic and zod schema can't see: shell `tool:` refs that aren't in the known-tools catalog, `signal.mapping` fields naming an output key the agent doesn't declare, typed-widget field names not matching declared outputs.
- **`PlannerLoopStepLogStore`** — append-only SQLite table `planner_loop_steps` (one row per primitive invocation per attempt). Persisted from the dashboard route after each `loopRunner.advance()` so per-run "what did the planner actually do" can be reconstructed from a single SELECT.
- **Telemetry columns** — `smoke_run_status` and `smoke_run_errors` added to `planner_telemetry` (PRAGMA-guarded ALTER, safe on existing DBs).
- **Combined feedback** — when both critic and smoke flag issues, both blocks are appended to the GOAL on retry so the planner sees the full picture.

The dashboard route now threads `loadKnownToolIds` (builtins + user tools) into the runner. Smoke-flagged retries surface as `smokeErrors: [{ agentId, errors[] }]` alongside `criticErrors` in the wizard's polling response.

19 new tests across smoke-eval, step-log-store, and runner. Second of a planned 4-PR refactor (see [plan](/.claude/plans/i-need-to-refactor-peaceful-salamander.md)).
