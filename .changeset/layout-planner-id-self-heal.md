---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

The Improve-layout wizard now auto-retries once on schema-validation failures, and the planner prompt has a strict, example-laden agent-id-format rule up front. Cuts down on user-facing schema errors like `topAgents.id must be lowercase_with_dashes_or_underscores` that the planner can fix itself.
