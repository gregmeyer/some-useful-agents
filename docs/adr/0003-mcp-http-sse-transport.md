# ADR-0003: MCP via HTTP/SSE streamable transport

## Status
Accepted

## Context

The MCP (Model Context Protocol) SDK supports two transports for servers:

- **stdio** — the MCP client spawns the server as a child process and
  communicates over pipes. Typical for local single-client setups.
- **Streamable HTTP (SSE)** — the server runs as an HTTP service; clients
  connect via POST + SSE. Supports multiple concurrent clients.

Our architecture has multiple consumers of agent state: the CLI reads
directly, the future dashboard will poll, and Claude Code wants to list and
run agents via MCP. With stdio, only one client can connect at a time
(whoever spawned the server). A parallel concern: the MCP server container
would need to run as a long-lived HTTP service anyway for the dashboard,
making stdio awkward.

The outside-voice review during PR #3 flagged this explicitly: "MCP via stdio
= one client at a time. Will force rewrite to HTTP/SSE before Phase 3 is
done."

## Decision

Use streamable HTTP transport. The MCP server runs as a persistent HTTP
service on a configurable port (default `3003`, overridable via
`SUA_MCP_PORT` or `sua.config.json`). Claude Code connects via
`http://localhost:3003/mcp`.

## Consequences

**Easier:**
- Multiple simultaneous clients (CLI, dashboard, Claude Code) all work.
- The server is a normal lifecycle concern — `sua mcp start` runs it, pm2
  or launchd can daemonize it, standard HTTP debugging tools apply.
- Future remote access (behind auth) becomes a config change, not a rewrite.

**Harder:**
- Client configuration: users add an HTTP URL to their Claude Code settings
  instead of a spawn command. Slightly more setup friction.
- Port conflicts are possible; the project originally picked `3001`, then
  discovered the user had another MCP on that port. Made it configurable.

**Trade-offs accepted:**
- For single-client setups, stdio would have been simpler. The multi-client
  requirement (even eventual) makes HTTP the correct default.
