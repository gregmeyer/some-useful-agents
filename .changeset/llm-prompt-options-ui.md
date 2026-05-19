---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Expose per-node LLM options (provider, model, maxTurns, allowedTools) on the add-node and edit-node forms.

The schema has always honored these fields, but the dashboard only exposed `provider` (and only on the edit-node page). Authors who wanted to allowlist tools the LLM could invoke (Read, Write, Edit, web-search, MCP tools) or override the model had to drop to YAML. The deleted `claude-code` built-in tool used to surface them via its `toolInputs` schema; PR #297 inadvertently took that affordance with it.

A new `renderLlmOptions()` helper sits alongside the Prompt textarea on both forms, inside the same `data-node-field="llm-prompt"` container so the existing tool-picker show/hide logic catches it. A matching `parseLlmOptions()` reads the form body and persists fields on the node. Empty fields are omitted (no spurious `model: ''` in YAML).
