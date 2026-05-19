---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Constrain the layout-planner to curation-only and require plain-text question fields.

Two prompt fixes after live testing:

1. **Scope.** The planner was hallucinating a "suggest new agents" capability. It would list agents from training data (or from the prompt's own example agent ids) and claim to be adding them to the dashboard — but the commit endpoint can only curate within the agents already on the surface (`AGENT_METADATA`). The prompt now explicitly says: *you cannot suggest agents that aren't in `AGENT_METADATA`*. If the user's FOCUS asks for new agents, the planner emits a question redirecting them to Add tile / Build from goal. The `summary` field is also constrained — never claim to "suggest N new agents".
2. **Question format.** Clarifying questions were rendering as raw `**markdown**` and unbroken text because the LLM was stuffing multi-line bulleted catalogs into a single question's `text` field. The renderer (correctly) escapes HTML. Prompt now requires: one short plain-text question per entry, no markdown, no line breaks, alternatives live in `options[]` for select-style rendering — not enumerated inside `text`.
