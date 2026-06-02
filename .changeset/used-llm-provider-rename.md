---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Rename the LLM-provider field to usedLLMProvider for clarity.

`SpawnResult.usedProvider` and `NodeExecutionRecord.usedProvider` are renamed to
`usedLLMProvider`, so the LLM-provider axis (claude/codex/apple) reads clearly
next to the execution-backend axis (`usedWorkflowProvider`, local/temporal). The
SQLite column stays named `usedProvider` (mapped in the run store), so there's no
migration and existing data is untouched.
