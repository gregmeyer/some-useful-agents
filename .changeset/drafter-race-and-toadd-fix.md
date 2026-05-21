---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Two fixes for the Improve-layout draft flow:

1. **Drafter run-id race**: serialize the orchestrator's drafter kickoffs. `kickoffAgentRun` resolves the new run-id via `queryRuns(agentName, limit: 1)` which is racy when N parallel kickoffs target the same agent — all three queries returned the same most-recent run-id and downstream polling observed the SAME run thrice. Symptom: 3 parallel "drafts" all produced identical output (same id, "agent-id already exists" collisions on 2 of 3). Serializing the kickoffs (a few-hundred-ms overhead) makes each query see its own freshly-created run. The LLM calls themselves still run in parallel.

2. **Speculative `toAdd`**: tighten the layout-planner prompt with a `BEFORE_TOADD_RULE`. Every id in `toAdd[]` must be justified by a quotable substring of FOCUS. "Complements the layout" / "is a useful default" are NOT valid justifications. Adds 4 concrete examples (when toAdd is allowed vs must stay empty). Addresses `system-health` showing up whenever the user looks at a monitoring-themed dashboard, even when they asked for 3 brand-new agents.
