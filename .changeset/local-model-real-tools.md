---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Local/OpenAI-compatible models can now call MCP + integration tools, not just builtins.

The model-driven tool loop (behind a `kind:'openai'` custom provider) previously
exposed only builtin tools, because generated integration ids (`csv.read.…`) and MCP
tool ids contain dots — invalid as OpenAI function names. The loop now exposes builtin,
generated integration (csv/postgres/sqlite), and MCP tools: dotted ids are given safe
function names and mapped back on the way in, and dispatch is unified through a new
`llm-tool-dispatch` module that resolves builtin → generated → MCP the same way the DAG
executor does (including the MCP server-enable gate and pooled client). Tool output fed
back to the model is size-capped to protect the context window.

Authoring: the dashboard node editor gains a "Tools the model may call" field
(registry ids), distinct from "Allowed tools" (Claude/Codex CLI names). Works on the
OpenAI-compatible HTTP path only; claude/codex run their own tool loops. Shell/claude-code
user tools and per-action schemas for multi-action tools remain out of scope.
