---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Planner refactor PR 1 — extract the inline critic-retry from run-now-build into a `PlannerLoopRunner` class with named phases (observe / evaluate / reflect / compose / done / failed). Behaviour-equivalent.

The extract → parse → schema-validate → autofix → critic → maybe-retry sequence used to live inline at run-now-build.ts:820-950. It's now in `packages/core/src/planner-loop/{types,primitives,runner}.ts`. Each primitive is a small TS function; the runner orchestrates them and emits a uniform `LoopStepRecord` per phase so PR 2 can drop a smoke-run eval next to the critic and PR 3 can add cross-run memory without churning the dashboard route.

No user-visible change. Tests cover the 9 distinct paths through the runner (no plan, JSON parse fail, schema invalid, fallback to nodeExecResult, critic pass, critic fail with retry, critic fail with budget exhausted, retry-spawn-fails, autofix invocation). First of a planned 4-PR sequence (see plan).
