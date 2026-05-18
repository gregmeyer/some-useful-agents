---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Add `llm-prompt` as the canonical node type for LLM-prompt steps; keep `claude-code` as a legacy alias.

The `claude-code` spelling was load-bearing in agent YAML even though the field has always been provider-agnostic (the actual CLI is chosen by `provider:`). This release teaches the schema, dispatcher, and UI to accept both spellings interchangeably. A new `isLlmPromptType()` helper consolidates the recognition logic. Every existing agent loads byte-identically — no migration required.

Authors writing new agents can use either spelling. Future releases will migrate the example agents and docs to `llm-prompt`.
