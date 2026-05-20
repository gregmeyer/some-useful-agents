---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix Improve-layout inline drafting: commit each drafted agent as its own single-agent BuildPlan instead of batching them into one commit. The commit endpoint schema requires `intent='agent'` to have exactly one `newAgents` entry, so the batched commit failed validation when the user drafted more than one agent at a time. Now: one commit per drafted agent, sequential; partial successes are surfaced and the layout still applies for whatever landed.
