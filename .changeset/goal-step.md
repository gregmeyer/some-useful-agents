---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

New `type: goal` step: give the model a goal, tools, and a budget, and it works until it can answer.

A goal step (`goal`, `tools`, `budget: { maxTurns, timeoutSec }`) lets the model loop: decide, call a tool, read the result, and repeat until it finishes with its answer inside `<final>…</final>`. When the agent declares `outputs:`, the model returns those fields as JSON, so templates and widgets work. Running out of turns or time without a final answer fails the step as "Ran out of budget" (`budget_exhausted`), with the limit it hit, instead of passing a half-answer on. A goal step runs on any provider that can call tools (claude, OpenAI-compatible models), with the same tools, tool-call trace, and policy checks as any other step. It also composes with ordinary flows. See docs/goal-agents.md and ADR-0037.

Also fixes agent-level `timeoutSec` and `runOn`, which validated but were dropped when an agent was loaded from YAML or saved. The wall-clock cap never applied, and `runOn: temporal` was ignored. The dashboard's step editor now sends goal steps to the YAML editor instead of rewriting them as shell steps.
