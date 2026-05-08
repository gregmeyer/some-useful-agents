---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build planner: critic loop with auto-retry + tighter commit telemetry.

The build wizard now structurally validates each plan before showing it to you. New `critiquePlan()` walks every newAgent YAML through `parseAgent`, checks dashboard refs against your actual catalog, and verifies that `loopConfig.agentId` / `agentInvokeConfig.agentId` cross-references inside generated agents resolve to either an installed agent or another newAgent in the same plan.

When the critic flags issues, the planner is re-fired up to two more times with a structured "Critic feedback:" block appended to the goal — so it sees exactly which fields to fix. After all retries exhaust, the wizard surfaces the remaining issues with a "Commit anyway" override so you stay in control.

Telemetry: `recordCommit` now only fires when an agent or dashboard actually landed, so `/metrics/planner` no longer counts dismissed/failed commits toward commit-rate. Retry attempts are routed back to the original telemetry row via the new alias map, so per-pipeline metrics stay accurate.
