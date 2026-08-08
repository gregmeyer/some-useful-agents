---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

MCP outbound client: migrate to SDK v2 with automatic era negotiation.

The client sua uses to consume external MCP servers (as agent tools and as
`mcp-tool` notify destinations) now runs on `@modelcontextprotocol/client` v2
with `versionNegotiation:'auto'`, so a single connection transparently talks to
both 2025-era and 2026-07-28 external servers. Connection pooling, stdio +
streamable-HTTP transports, and the `callMcpTool`/`listMcpTools` surface are
unchanged for callers.

Because agent tool calls are non-interactive, the client keeps the SDK's
non-fulfilling `inputRequired` default: a remote server that demands mid-call
input surfaces as an error instead of hanging the DAG node.
