---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

MCP servers as a first-class entity.

Tools imported from an MCP server are now grouped under a named server record. The new `mcp_servers` SQLite table plus an additive `mcp_server_id` column on `tools` lets the dashboard manage whole servers at once — enable/disable gates every tool from that server without deleting anything, delete cascades to all its imported tools.

- New `type: 'mcp'` tool implementation with pooled MCP client (stdio + streamable-HTTP)
- `/tools/mcp/import` accepts a Claude-Desktop/Cursor `mcpServers` config, a bare map, or a single `{command,args,env}` entry. JSON and YAML. Multi-server paste discovers every entry in parallel and groups the picker by server.
- `/tools/mcp/import` also has a "Quick add by URL" shortcut for HTTP servers.
- `/settings/mcp-servers` — table with tool counts, enable/disable toggle, cascade delete.
- Executor gate: nodes referencing a tool from a disabled server fail with `errorCategory: 'setup'` and a clear "server X is disabled" error.
- Tool detail page shows the source server with a link back to settings.

Parser exported from core: `parseMcpServersBlob`, with per-entry errors so a partially-valid blob still yields the servers that *are* valid.
