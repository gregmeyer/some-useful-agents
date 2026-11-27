# MCP servers

sua treats **MCP servers as first-class entities** — a server is a grouping of tools, imported once and then referenced by any number of agent nodes. Enable/disable the server and every tool from it is gated accordingly. Delete the server and its tools cascade out with it.

This page covers both directions. Most of it is about **importing** other servers so your agents can call their tools. [Using sua from another app](#using-sua-from-another-app) covers the other direction: `sua mcp` serving sua's own tools to Claude Desktop, Codex or another agent. For protocol internals see the [MCP specification](https://modelcontextprotocol.io).

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
  type: llm-prompt
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

**Dashboard:** [Tools → Servers](http://127.0.0.1:3000/tools?tab=servers)

Table columns: **Id**, **Transport**, **Target** (command+args or URL), **Tools** (count), **Status**, **Actions**.

| Action | Effect |
|---|---|
| **Disable** | Every tool from this server is gated. Runs that reach one of those tools fail with `errorCategory: setup` and a message: *`MCP server "<id>" is disabled. Re-enable it under Tools → Servers.`* |
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

On Pulse (`/pulse`) the run's output widget will render (assuming the agent has one declared).

### Where a Docker server saves files

A server running in Docker saves inside its container. Only a folder it shares with this computer (`-v /path/to/output:/app/output` above) reaches you, so Graphics creator saves into `output` (its `OUTPUT_DIR`, as the server sees it from its working folder `/app`), and sua reads the file from the matching folder here. sua works this out from the server's own `docker run` command (`-v`, `--volume`, `--mount type=bind`, `-w`): a path the server reports, `/app/output/pbj.png` or `output/pbj.png`, opens as `/path/to/output/pbj.png`. That's how its picture shows in a conversation and on a run's page, and can be added to an answer. Only pictures, pages and PDFs are served from a shared folder. A path outside every shared folder (say `.sua/graphics-output/…`) stayed in the container: the conversation says so rather than showing a broken image.

### Keeping Docker containers from piling up

Each `docker run` makes a container. `--rm` removes it when the server stops, so two things keep them from piling up:

- **sua closes a server it hasn't used for 10 minutes.** Its container stops and is removed, with anything the server saved inside it; the next call starts a fresh one. A long-running worker no longer keeps one container for days.
- **Clean up** (Tools → Servers, on a server run in Docker) removes the containers of that server's image that are stopped or were made and never started (a start cut short leaves one, and `--rm` doesn't remove it). Running ones are left alone: they're in use, by sua or by another program set up with the same server (an editor or another agent), and each goes when that program closes it.

## Operational notes

- **First call per server** includes the docker-container or child-process startup cost. Subsequent calls in the same sua process reuse the pooled client.
- **Server env** from the paste is merged over `process.env` — anything you set there overrides host env for the child process only.
- **HTTP transport** uses the MCP streamable-HTTP spec. Plain SSE is not a supported client yet.
- **Protocol versions** — sua runs the MCP **2026-07-28** spec via SDK v2. The outbound client negotiates the era automatically (`versionNegotiation:'auto'`), so it consumes both 2025-era and 2026-07-28 external servers from one pooled connection. Because agent tool calls are non-interactive, a server that demands mid-call input (`inputRequired`) surfaces as an error rather than hanging the node.
- **Re-importing** a server (same id) is idempotent: the row is upserted, existing tool ids are skipped, new tools are created.
- **No certificate pinning** for HTTP servers yet. Run loopback-only unless you trust the network path.

## Using sua from another app

`sua mcp start` runs sua's own MCP server on `http://127.0.0.1:3003/mcp`. Point any MCP client at it with the bearer token from `~/.sua/mcp-token`:

```json
{
  "mcpServers": {
    "some-useful-agents": {
      "url": "http://127.0.0.1:3003/mcp",
      "headers": { "Authorization": "Bearer <token from ~/.sua/mcp-token>" }
    }
  }
}
```

It serves these tools. Your [tool policy](tool-policies.md) applies to each one, the same as for an agent. See [SECURITY.md](SECURITY.md#mcp-server-v040) for what the token lets a client do, and [Notebooks over MCP](SECURITY.md#notebooks-over-mcp) for the notebook tools.

| Area | Tools | What they do |
|---|---|---|
| Agents and runs | `list-agents`, `run-agent`, `get-status`, `get-logs`, `cancel-agent`, `list-runs` | Run agents marked `mcp: true` and follow their runs. `run-agent` also holds conversations (`message` + `sessionId`); see [conversations.md](conversations.md). |
| Notebooks | `notebook-read`, `notebook-templates`, `notebook-create`, `notebook-create-status`, `notebook-tldr` | Read what a notebook knows; list your templates; start a new notebook from a template or a sentence, and follow it until it's made; redraw a notebook's TL;DR picture. See [notebooks.md](notebooks.md#notebooks-from-elsewhere) and [tools/notebook-create.md](tools/notebook-create.md). |
| Experiments | `experiment-read` | Read what an experiment found. See [experiments.md](experiments.md). |
| Boards | `board-read`, `board-place`, `build-board`, `board-build-status` | Arrange a board, or build a whole one from a request. See [boards.md](boards.md). |
| Today's edition | `edition-read`, `edition-apply` | Read how Pulse's Today's edition is made and how fresh each part is (its age, a failed run, why it's in); change it with the same ops as its Ask box (lead, hide, show, include, auto, width, numbers, top-story, note, reset), or `undo: true`. A policy rule on `edition-apply` (resource `today`) can block it. Running a part again is `run-agent`. See [boards.md](boards.md). |
| Home and attention | `surface-read`, `surface-apply`, `items-read` | Read and change how Home is arranged; list what needs the person's attention. See [surfaces.md](surfaces.md). |

**As an A2UI page.** For one notebook read whole, `notebook-read` also returns the notebook as A2UI 1.0 data (an embedded `application/a2ui+json` `updateDataModel`) for the `a2ui://notebook` layout resource, named in `_meta.ui.resourceUri`. A host that draws A2UI shows a compact page: where it stands, what it rests on, the options, what's open, the done-whens. It uses only A2UI's basic components. Other hosts get the text as before ([ADR-0090](adr/0090-a2ui-over-mcp.md)).

### Starting a notebook from another app

The notebook tools are meant to be used in order. Say another agent is asked to "make a company briefing on Duolingo":

1. **`notebook-templates`** lists your templates with what each is for, its steps, the page it opens on and the subject it needs. The agent sees that Company briefing fits (a company with no meeting in view), not Meeting briefing.
2. **`notebook-create`** with `{"template": "company-briefing", "subject": "Duolingo, duolingo.com", "start": true}`. The website is split off the name and kept as the company's own site. The reply carries a request id.
3. **`notebook-create-status`** with that id. A few seconds later the request is `ready`, with the notebook's id and link, `/notebooks/company-briefing-duolingo`.
4. **`notebook-read`** reads what it found once its steps have run.

If the agent sends a sentence (`ask`) instead and one of your templates fits it, nothing is started; the reply names the template to use. The dashboard makes the notebook, so it has to be running. You'll find a note in your inbox for each notebook another app starts.

## Related

- [Tool reference](tools.md) — including [`docs/tools/mcp.md`](tools/mcp.md) for the generic MCP tool type schema
- [Security model](SECURITY.md#mcp-server-trust) — trust boundaries around imported servers
- [`notebook-create`](tools/notebook-create.md) — starting notebooks from another app
- [ADR 0019: MCP servers as first-class](adr/0019-mcp-servers-first-class.md) — why a dedicated table rather than inline config on every tool
