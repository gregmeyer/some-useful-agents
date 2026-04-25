# ADR-0019: MCP servers as a first-class entity

## Status
Accepted

## Context
The v0.17 MCP tool type stored each imported tool's server connection config (transport, command, args, env, URL) directly on the tool row's `implementation`. This was fine for one server. With multiple servers — and realistic Claude Desktop / Cursor configs routinely hold 5–10 — we hit three problems:

1. **Server-level enable/disable is impossible.** "Disable modern-graphics for now" means toggling N tools individually; they drift.
2. **Editing the server config means touching every tool.** Args change, env var added — all tools from that server need the same edit.
3. **Deletion is an all-or-nothing loop.** No way to say "this server is gone, drop its tools" without manual multi-delete.

A user's mental model is "I imported this server and its tools came with it." The data model should match.

## Decision
Promote server to a first-class entity. Add a `mcp_servers` table with (id, name, transport, command, args_json, env_json, url, enabled, timestamps). Add an additive `mcp_server_id` column on `tools` (nullable) via `ALTER TABLE` — the same try/catch pattern `agent-store.ts` uses for idempotent additive migrations.

Connection config moves to the server row. Imported tool rows still carry a full `implementation` (so the MCP client doesn't need to look up the server to connect) but also point back via `mcp_server_id`. The tool's `mcp*` fields remain the source of truth for the connection — the server row is authoritative for *grouping* and *enable/disable*.

Server CRUD goes through new methods on `ToolStore`: `listMcpServers`, `getMcpServer`, `createMcpServer`, `updateMcpServer`, `upsertMcpServer`, `setMcpServerEnabled`, `deleteMcpServer` (cascades to tools by `mcp_server_id = ?`).

The executor gates MCP tool dispatch on `getToolServerId(id)` + `getMcpServer(sid).enabled`. A disabled server's tool fails the node with `errorCategory: 'setup'` and the message *`MCP server "<id>" is disabled. Re-enable it under Settings → MCP Servers.`*

## Consequences
**Easier:** manage fleets of MCP servers in one place; disable a flaky server without losing the import; delete-and-reimport preserves intent; user-visible settings page (`/settings/mcp-servers`) ships with no additional plumbing.

**Trade-off:** two places store the `mcpCommand`/`mcpUrl` (server row + tool row). We accept the duplication because keeping the tool row self-sufficient means the MCP client doesn't do a join lookup per call — the per-tool `implementation_json` stays a complete spec. When we eventually support editing the server config post-import, we'll walk the tool rows and rewrite them in the same transaction.

**Not done here:** editing server config after import (delete + reimport for now); per-tool enable/disable (server-level is enough for the initial surface); auto-refresh of tool schemas when a remote server adds/removes tools.

## Alternatives considered
- **Composite-key grouping** on `(command, args, env, url)` without an explicit server row. Rejected — brittle (whitespace / order variations), no name, no enable flag, can't rename.
- **Store connection config only on the server row, foreign-key from tool.** Requires a join on every MCP tool call. Rejected because the MCP client path is hot and already has a pool keyed by config signature; an extra DB read per call is wasteful.
