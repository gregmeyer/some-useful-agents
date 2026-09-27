---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Claude can now call every sua tool a node declares.

A node's `tools:` used to work fully only on OpenAI-compatible providers. On claude, only `web-fetch` and `web-scrape` worked, mapped to claude's own WebFetch, and any other tool made the fallback chain skip claude. So an agent's abilities depended on which provider answered. sua now serves the node's tools to claude through a short-lived local MCP endpoint for each attempt. It is bound to 127.0.0.1 with a random bearer token, and its config lives in a temp file readable only by you. claude loads it with `--strict-mcp-config`, so your own claude MCP servers stay out of agent runs. Builtin, integration and imported MCP tools all work, through the same executor, allowlist, policy check and tool-call trace as the HTTP path. Codex and Apple Foundation Models are still skipped for nodes with tools. See ADR-0036.

Also: claude's "Not logged in · Please run /login" is now classified as `auth_required` (falls back) instead of an unknown error that stopped the chain.
