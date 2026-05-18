---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Remove the relic `claude-code` built-in tool. Use `type: llm-prompt` (or legacy `type: claude-code`) instead.

The `claude-code` built-in tool was marked in-source as "Backcompat tool for v0.15 type:claude-code nodes" and had zero callers in any in-tree agent. It only existed as a UX device — the dashboard tool picker used `'claude-code'` as a sentinel string to drive a hidden `type` field on the form. This release deletes the built-in tool registration and replaces the picker entry with a synthetic `llm-prompt` option that submits `type: llm-prompt` directly. The "Analyze with LLM" Quick Start pattern follows.

CLI `sua agent new` and `sua agent audit` now use the canonical `llm-prompt` spelling in prompts and output. The v1 agent schema accepts `'llm-prompt'` alongside the existing `'claude-code'` and `'shell'`. `docs/tools/claude-code.md` was removed (it's a node type, not a tool); `docs/tools.md` points readers at `type: llm-prompt` on the node.

Authors who wrote `tool: 'claude-code'` in YAML by hand will now see a "Tool not found in registry" error at run time. Mitigation: replace with `type: llm-prompt` (or `type: claude-code` legacy alias) and an inline `prompt:`.

Closes the LLM-prompt unification plan (PR 3 of 5). PR 5 will surface installed providers in the tool catalog.
