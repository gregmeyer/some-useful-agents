# MCP servers

sua treats **MCP servers as first-class entities** — a server is a grouping of tools, imported once and then referenced by any number of agent nodes. Enable/disable the server and every tool from it is gated accordingly. Delete the server and its tools cascade out with it.

This page covers the user surface: how to import a server, how imported tools behave, how to manage the fleet. For protocol internals see the [MCP specification](https://modelcontextprotocol.io).

## Mental model

| Concept | What it is | Where it lives |
|---|---|---|
| **MCP server** | A process or endpoint speaking the MCP protocol (e.g. `modern-graphics`, `slack-mcp`) | `mcp_servers` table in the runtime DB |
| **Imported tool** | A local tool row with `type: mcp` linked to one server | `tools` table, `mcp_server_id` column |
| **Tool call at run time** | A node invokes the local tool; the executor opens (or reuses) a pooled MCP client and calls the remote tool | Executor → pooled client → server |

The server config (command, args, env for stdio; URL for HTTP) is stored once on the `mcp_servers` row. The imported tool rows carry only the *remote tool name* and a pointer back to the server. Editing the server config (not yet exposed in UI — delete + reimport) applies to every tool at once.

## Importing a server

**Dashboard:** [/tools/mcp/import](http://127.0.0.1:3000/tools/mcp/import)

Two paths on one page:

### Paste a config

The textarea accepts three shapes. Whatever you paste, each entry becomes one server.

**Claude-Desktop-style (most common):**

```json
{
  "mcpServers": {
    "modern-graphics": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "modern-graphics"],
      "env": {}
    }
  }
}
```

**Bare map (Cursor-style, no wrapper):**

```json
{
  "modern-graphics": { "command": "docker", "args": ["run", "--rm", "-i", "modern-graphics"] },
  "slack-mcp": { "url": "http://127.0.0.1:4000/mcp" }
}
```

**Single entry (one anonymous server):**

```json
{ "command": "npx", "args": ["-y", "some-mcp-server"] }
```

YAML equivalents work too. Click **Discover tools** — sua opens a client against each entry in parallel, runs `tools/list`, and presents a grouped picker. Uncheck anything you don't want, click **Create selected tools**.

### Quick add by URL

For servers reachable over HTTP, fill in just the URL (e.g. `http://127.0.0.1:4000/mcp`) and an optional display name. sua synthesizes a one-line config and runs the same discovery flow.

**Note:** stdio servers (docker, npx, local binaries) must use the paste form — there's no URL.

## Running an imported tool

Imported tools look like any other. A node references them by the local id:

```yaml
- id: hero
  type: claude-code
  tool: modern-graphics-generate-graphic
  toolInputs:
    layout: hero
    title: "{{inputs.TOPIC}}"
    subtitle: "For {{inputs.AUDIENCE}}"
```

Local tool ids follow the pattern `<server-id>-<slugified-remote-name>`. The server id is derived from the pasted key (e.g. `modern-graphics`); remote names are slugified (`generate_graphic` → `generate-graphic`).

At run time the executor:

1. Looks up the local tool → finds `type: mcp` + `mcp_server_id`
2. Verifies the server is enabled (see below)
3. Gets or opens a pooled MCP client for that server
4. Resolves `{{upstream.*}}` and `{{vars.*}}` in `toolInputs`
5. Calls `tools/call` on the remote tool with the resolved inputs
6. Wraps the response (text blocks joined into `result`, structured content preserved as fields)

Pooled clients are keyed by (transport, command+args) or URL — the same server serves every node in the run without respawning.

## Managing imported servers

**Dashboard:** [/settings/mcp-servers](http://127.0.0.1:3000/settings/mcp-servers)

Table columns: **Id**, **Transport**, **Target** (command+args or URL), **Tools** (count), **Status**, **Actions**.

| Action | Effect |
|---|---|
| **Disable** | Every tool from this server is gated. Runs that reach one of those tools fail with `errorCategory: setup` and a message: *`MCP server "<id>" is disabled. Re-enable it under Settings → MCP Servers.`* |
| **Enable** | Removes the gate. |
| **Delete** | Drops the server row AND cascade-deletes every tool imported from it. Agents that reference those tools will fail on their next run. |

Toggling is atomic and cheap — the executor re-reads the flag on every node, so a disable takes effect for the next-running node.

## Worked example

**Goal:** run [`graphics-creator-mcp`](../agents/examples/graphics-creator-mcp.yaml) end-to-end using the `modern-graphics` MCP server.

```bash
# 1. Make sure the modern-graphics docker image exists locally:
docker images | grep modern-graphics

# 2. Start sua's dashboard:
sua dashboard start
```

At `/tools/mcp/import` paste:

```json
{
  "modern-graphics": {
    "command": "docker",
    "args": [
      "run", "--rm", "-i", "--ipc=host",
      "-v", "/path/to/output:/app/output",
      "-w", "/app",
      "--entrypoint", "python",
      "modern-graphics",
      "-m", "modern_graphics.mcp_server"
    ]
  }
}
```

Click **Discover**. Select at least: `set_output_root`, `create_theme`, `save_theme`, `generate_graphic`, `composite_image`. Click **Create**.

Now run the agent:

```bash
sua workflow run graphics-creator-mcp \
  -i TOPIC="Q2 growth wins" \
  -i AUDIENCE="investors"
```

At `/pulse` the run's output widget will render (assuming the agent has one declared).

## Operational notes

- **First call per server** includes the docker-container or child-process startup cost. Subsequent calls in the same sua process reuse the pooled client.
- **Server env** from the paste is merged over `process.env` — anything you set there overrides host env for the child process only.
- **HTTP transport** uses the MCP streamable-HTTP spec. Plain SSE is not a supported client yet.
- **Re-importing** a server (same id) is idempotent: the row is upserted, existing tool ids are skipped, new tools are created.
- **No certificate pinning** for HTTP servers yet. Run loopback-only unless you trust the network path.

## Related

- [Tool reference](tools.md) — including [`docs/tools/mcp.md`](tools/mcp.md) for the generic MCP tool type schema
- [Security model](SECURITY.md#mcp-server-trust) — trust boundaries around imported servers
- [ADR 0019: MCP servers as first-class](adr/0019-mcp-servers-first-class.md) — why a dedicated table rather than inline config on every tool
