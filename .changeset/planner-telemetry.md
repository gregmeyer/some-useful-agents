---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build-planner telemetry — `/metrics/planner` view + per-run record.

The build-planner pipeline (`POST /agents/build` → poll → commit) was previously a black box: we couldn't measure how often plans extracted cleanly, how often `autoFixYaml` had to rescue an LLM mistake, or how plans-attempted mapped to plans-committed. This PR records one row per planner run in a new `planner_telemetry` table (sibling to `runs`, foreign-keyed with `ON DELETE CASCADE`) and surfaces aggregates at `/metrics/planner`.

Captured per run: `plan_attempts` (1 today; PR2's critic-loop will increment), `plan_extract_status` (`ok` / `no-json` / `schema-invalid`), `plan_autofix_count`, `plan_validation_errors`, `time_to_plan_ms`, `time_to_commit_ms`, `committed_at`, `goal` (truncated to 1KB), `intent`.

The headline metric — **first-attempt clean rate** — is the baseline for future quality work. PR2 (plan critic + auto-retry) and beyond can be measured against this.
