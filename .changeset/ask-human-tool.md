---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

llm and goal nodes can ask you mid-step: the `ask-human` tool.

List `ask-human` in a node's `tools:` and the model can ask a question (with optional choices) when it needs a decision or a fact only you have. The question goes to the inbox like an `ask` node's, the step stops at once without falling back to another provider, and the run waits. When you answer, the step starts again with the earlier questions and answers in front of the model. Up to 3 questions per step. Works on Temporal workers too. See docs/ask-a-person.md.
