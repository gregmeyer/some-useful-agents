---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Triage can now resolve a thread it has fully handled.

When a thread is done — the operator says "thanks, that's all", or the request is
fully answered with nothing left to run or diagnose — triage can close it itself
with a new `resolve-thread` action instead of telling the operator to click
Resolve. It sets the thread status to `resolved` synchronously (no agent runs),
posts a short acknowledgment, and is excluded from the auto-follow-up trigger so
closing a thread never spawns another triage turn. The kernel teaches strict
guardrails: never resolve while a question is pending, an action is still
running, or a reported problem hasn't actually been addressed.
