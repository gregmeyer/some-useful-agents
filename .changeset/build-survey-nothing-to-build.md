---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Build-from-goal no longer crashes when the goal is already covered by an existing agent. The goal-surveyor can legitimately return `intent="agent"` with a matched existing agent and zero fragments to draft ("you already have this") — the old strict survey validation rejected that with `Survey failed validation: fragments: intent="agent" requires exactly one fragment, got 0`. Intent is now treated as a hint rather than a contract: the survey-schema drops the intent-vs-content cross-validation, and the orchestrator decides from the actual fragments + matched agents. When there's nothing new to draft but the goal matches installed agents, the wizard shows a friendly "Nothing to build — already covered by these agents" screen (with links) instead of an error.
