---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Bump the build-planner's `plan` node from `timeout: 180 / maxTurns: 3` to `timeout: 360 / maxTurns: 5`. Three-minute ceiling was too tight when the planner has to draft multiple agents in one shot (now common via the Improve-layout → Build-from-goal hand-off, which can hand off up to 3 needsNew specs at once). Six minutes / five turns gives Claude room to produce the full plan without router-level timeouts.
