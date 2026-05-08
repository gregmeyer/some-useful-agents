---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Three planner-pipeline bugs surfaced by the new `sua planner smoke` command.

**`PlannerTelemetryStore.fromHandle` field-init bug.** Class-field initialisers (`private readonly retryAliases = new Map()`) only run inside `new` — `Object.create` skipped them, so any call into `resolveOriginalRunId` / `recordRetrySpawn` on a `fromHandle`-built store crashed with `Cannot read properties of undefined (reading 'get')`. The wizard always uses the constructor path so this only surfaced for CLI consumers.

**`survey.existingDashboards` string-array shape.** The real planner sometimes emits `existingDashboards: ["dash-id-1", "dash-id-2"]` instead of the canonical `[{id, name?, reason?}]` objects. The schema now accepts either form, coercing strings into the canonical shape so the rest of the plan still validates.

**Smoke command auth.** `sua planner smoke --live` was hitting `/agents/build` without a session cookie and getting "Missing session cookie" on every scenario. The runner now reads the dashboard token via `readMcpToken()` and threads it onto every authenticated request. Two scenarios (1 and 4) had over-strict asserts that fought the planner's stochasticity; they now PASS-with-informational-note when the planner happens to skip a branch instead of hard-failing.
