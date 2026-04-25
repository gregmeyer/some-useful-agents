# MCP tool type

The `mcp` implementation type tells the executor "dispatch this node through a pooled MCP client instead of spawning a process." Every tool row imported via `/tools/mcp/import` has `implementation.type: mcp`.

This page covers the tool's schema. For the server-management UX (import, enable/disable, delete), see [MCP servers](../mcp.md).

## Schema

```yaml
id: modern-graphics-generate-graphic
name: generate_graphic
source: local
inputs:
  # Auto-populated from the MCP server's tools/list response:
  layout: { type: string, required: true }
  title: { type: string }
  # ...
outputs:
  # Empty by default — the MCP response becomes fields
implementation:
  type: mcp
  mcpTransport: stdio           # "stdio" | "http"
  mcpCommand: "docker"          # stdio: executable
  mcpArgs: ["run", "--rm", ...] # stdio: args
  mcpEnv: { FOO: "bar" }        # stdio: env vars (merged on top of process.env)
  mcpUrl: "http://..."          # http: endpoint
  mcpToolName: "generate_graphic"  # remote tool name on the server
```

The tool row **also** has an `mcp_server_id` FK pointing to the `mcp_servers` table (which stores the same connection config, authoritatively). Deleting the server cascades to every tool with that id.

## Runtime dispatch

When a node references an MCP tool:

1. Executor loads the tool row
2. Checks `getToolServerId(id)` → resolves the server → verifies `enabled = true`
3. Resolves `{{upstream.*}}` / `{{vars.*}}` / `{{secrets.*}}` in both the impl fields (`mcpUrl`, `mcpCommand`, `mcpArgs`, `mcpEnv`) and the `toolInputs`
4. Gets or opens a pooled MCP client (keyed by transport + command/url signature)
5. Calls `tools/call` with the resolved name + arguments
6. The response's text blocks are joined into `result`; `structuredContent` is merged as additional output fields

Failures at any step surface as a node error with `errorCategory: 'setup'` (server disabled, connect failed) or `'exit_nonzero'` (remote tool threw).

## Gated by server status

If the tool's server is disabled in `/settings/mcp-servers`, the node fails immediately with:

> `MCP server "<id>" is disabled. Re-enable it under Settings → MCP Servers.`

No connection attempt, no stderr, just a clear setup error.

## Writing a node

Exactly like any other tool:

```yaml
- id: hero
  type: claude-code
  tool: modern-graphics-generate-graphic
  toolInputs:
    layout: hero
    title: "{{inputs.TOPIC}}"
    subtitle: "For {{inputs.AUDIENCE}}"
```

`type: shell` or `type: claude-code` doesn't matter for MCP tools — the implementation takes over regardless. Pick whichever reads better.

## Notes

- **Client pooling** keys on `(transport, command+args)` for stdio or `url` for http. The same server serves every node in a run from one pooled client.
- **First call per server** includes container/process startup cost. Subsequent calls are fast.
- **Pool teardown** — `closeAllMcpClients()` is exported from core for tests and shutdown hooks.
- **No retry logic** — a failed call fails the node. Use `onlyIf` with a sibling node if you want fallback.

## Related

- [MCP servers](../mcp.md) — paste-config import, lifecycle
- [Security → MCP server trust](../SECURITY.md#mcp-server-trust) — threat model
- [ADR-0019: MCP servers as first-class](../adr/0019-mcp-servers-first-class.md) — data model
