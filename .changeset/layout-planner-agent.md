---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add the `layout-planner` agent.

Single-node `type: llm-prompt` agent at `agents/examples/layout-planner.yaml` that reads `CURRENT_LAYOUT` + `AGENT_METADATA` + an optional `FOCUS` statement and emits a structured `LayoutPlan` JSON (introduced in the previous PR) wrapped in `<plan>...</plan>` tags. The prompt teaches the LLM the ranking rules (FOCUS-first, then a recency × reliability × frequency combination), the container grouping rules (1–6 containers, unique labels, each tile in exactly one container), and when to emit clarifying questions (FOCUS empty → ask about ranking heuristic).

The route handler + UI come in a later PR; this commit is the agent and a regression test that locks the prompt's embedded `<plan>` example to the schema. Editing the prompt's example out of sync with the schema fails the test.
