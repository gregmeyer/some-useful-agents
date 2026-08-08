---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

MCP inbound server: migrate to the 2026-07-28 spec (SDK v2, stateless transport).

The inbound MCP server (which exposes your agents to Claude Desktop / Cursor) now
runs on the stateless MCP 2026-07-28 protocol via `@modelcontextprotocol/server`
v2's `createMcpHandler`. There is no longer an `Mcp-Session-Id` or in-memory
session map — each request is self-contained and re-authenticates against the
bearer token, so the server can sit behind ordinary load balancers. Existing
2025-era clients (including current Claude Desktop installs) keep working
unchanged via the `legacy: 'stateless'` compatibility mode; no config change is
required.

Security note: the previous session-to-token binding (which stopped a rotated
token from hijacking a live session) is removed because the stateless protocol
has no sessions to hijack — every request runs the full Host/Origin + bearer
check fresh. The loopback Host/Origin defenses and single shared bearer-token
model are otherwise unchanged.
