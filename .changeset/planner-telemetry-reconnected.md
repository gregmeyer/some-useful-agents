---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Reconnect Build-from-goal telemetry — `/metrics/planner` has been reporting on a dead dataset.

Every planner row recorded since **2026-05-20** is empty: `plan_extract_status` stuck at the
`pending` schema default, no plan time, no outcome, no commit. Not one row in 3.5 months.

`/build` moved onto the orchestrator (`startBuildSession`) in #326, on exactly that date.
`recordStart` still fires from the route, so rows kept being created — but every *later* write
(`recordExtract`, `recordSmoke`, `incrementAttempts`) lives on the `PlannerLoopRunner` path, and the
poll handler returns as soon as `getSession()` matches an orchestrator session, so that code is
never reached. `recordCommit` failed differently: it is gated on
`runStore.getRun(plannerRunId)?.startedAt`, and `plannerRunId` is now an in-memory session id
(`build-<ts>-<rand>`) that never reaches the run store — 0 of the 12 ids recorded since May exist in
`runs`. So commits could not be recorded either, which is why the commit rate reads as zero rather
than low.

The page looked plausible the whole time, which is why nobody noticed.

Now the orchestrator stamps its own outcome as a session reaches a terminal phase — recorded once,
in one place, guarded by the same early-return that makes the poll idempotent. `recordCommit` falls
back to the telemetry row's own `createdAt` when there is no run record.

`plan_extract_status` gains two values: **`failed`** (the build never reached a plan) and
**`nothing-to-build`** (the goal was already covered). Neither is an extraction problem, but both are
terminal outcomes worth measuring; the column is overloaded rather than renamed to avoid a
migration, and the histogram picks them up without a schema change.

**Historical rows are not backfilled** — the data was never captured and cannot be reconstructed.
Anything before 2026-05-20 remains valid; the 12 rows between then and now stay `pending`, which is
the honest record of the gap.
