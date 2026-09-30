---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Codex can call sua tools, so goal nodes and nodes with `tools:` run on Codex.

sua serves a node's tools to codex through the same per-attempt MCP endpoint claude uses, passed as `codex exec -c` config with the token in an environment variable, the tools pre-approved, and your own codex MCP servers switched off for the run. Codex is no longer skipped for nodes that declare tools. See docs/llm-providers.md and ADR-0044.
