---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Eliminate the kickoff race in the build orchestrator by accepting a caller-supplied `runId` on `executeAgentDag`'s options. `kickoffAgentRun` now pre-generates the run-id via `randomUUID()` and passes it through instead of trying to look up the just-created run via `queryRuns(agentName, limit: 1)` — that pattern was racy whenever multiple parallel kickoffs targeted the same agent (e.g. three `/agents/draft-one` requests, three `agent-drafter` runs, same agent name → all three queries returned the same most-recent row → all three "drafts" polled the same run → 1 succeeded, 2 failed with "agent id already exists"). Serializing the kickoffs (the previous fix in #330) only patched the in-orchestrator fan-out; this fix addresses the root cause so parallel `/agents/draft-one` calls work too.
