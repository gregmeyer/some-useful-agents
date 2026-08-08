---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

LLM tool-calling: local models can now call builtin tools mid-generation.

Under a custom OpenAI-compatible provider (a local model like Qwen), an
llm-prompt / claude-code node can let the model actually invoke builtin tools
(`web-scrape`, `web-fetch`, `http-get`, …) during generation — so agents authored
"tell the model to search the web" work instead of the model pretending. The
OpenAI invoker now runs a function-calling loop: it sends the exposed tools as
function schemas, executes each requested call (SSRF/size-capped by the tools,
and routed through the tool-policy seam), feeds results back, and loops until a
final answer or `maxTurns` (default 5).

Expose tools via a new node `tools: [...]` field (builtin ids); builtin-id
entries in `allowedTools` are also honored for back-compat. No tools listed →
plain completion (unchanged). Works on the OpenAI-compatible path only; the
claude/codex CLIs use their own tools (an MCP bridge for our builtins is a
follow-up).
