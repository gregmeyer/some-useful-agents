# Quickstart

30 minutes to your first running agent. If you want the 90-second summary: install, `sua init`, `sua workflow run hello`, `sua dashboard start`. Open `http://127.0.0.1:3000/`.

## Prerequisites

- Node.js >= 22.5.0 (`node --version`)
- macOS or Linux (Windows untested)

## Install

```bash
npm install -g @some-useful-agents/cli
# or skip the global install:
# npx @some-useful-agents/cli@latest init
```

## Initialize a project

```bash
mkdir my-agents && cd my-agents
sua init
```

This scaffolds:

- `agents/local/` — where your own agents live (empty at first)
- `agents/examples/` — 15 bundled example agents auto-installed into the DB
- `data/runs.db` — SQLite DB for runs, agents, tools, MCP servers
- `.sua/` — local config (variables, MCP token)

Check what landed:

```bash
sua workflow list           # see DAG agents in the DB
sua tool list               # see builtin + user tools
sua doctor                  # verify prerequisites + file perms
```

## Run your first agent

`hello` is the simplest bundled agent — one shell node that echoes.

```bash
sua workflow run hello
```

Output:

```
▶ hello #1 (running)
✔ main: hello world
✔ hello completed in 42ms
```

Re-run it a few times, then look at the history:

```bash
sua workflow list
```

## Open the dashboard

```bash
sua dashboard start
```

The first line of output prints a one-time sign-in URL with your bearer token in the fragment:

```
http://127.0.0.1:3000/auth#token=<64 chars>
```

Click it — the dashboard stores the cookie and bookmarks `http://127.0.0.1:3000/` as your landing page.

From here you can:

- Browse agents on `/agents` (tabs: User / Examples / Community)
- Run any agent from its card's ▶ button
- Watch live run progress at `/runs/:id`
- Inspect output widgets at `/agents/:id`
- Edit an agent's nodes, variables, and signal at `/agents/:id/config`

## Create your own agent

### From the dashboard (recommended)

1. `/agents/new` — fill in id, name, pick node type
2. Click Create → you land on the Nodes tab
3. Add more nodes, wire `dependsOn`, save
4. Click ▶ on the card to run

Or use **Build from goal** — describe what you want in plain English and Claude designs the whole agent YAML for you.

### From a YAML file

Create `agents/local/hello-mine.yaml`:

```yaml
id: hello-mine
name: My first agent
status: active
source: local

inputs:
  TOPIC:
    type: string
    required: true
    description: What to greet.

nodes:
  - id: greet
    type: shell
    command: echo "Hello $TOPIC, from sua!"
```

Import it:

```bash
sua workflow import-yaml agents/local/hello-mine.yaml
sua workflow run hello-mine -i TOPIC="world"
```

See [Agent YAML reference](agents.md) for the full field list.

## Chain two nodes

Agents are DAGs — every node declares its upstreams. Follow-on values flow through templated placeholders.

```yaml
id: two-step
name: Two-step
status: active
source: local

nodes:
  - id: fetch
    type: shell
    command: echo '{"count": 42}'

  - id: format
    type: shell
    command: echo "Count was $UPSTREAM_FETCH_RESULT"
    dependsOn: [fetch]
```

Import + run:

```bash
sua workflow import-yaml agents/local/two-step.yaml
sua workflow run two-step
```

Same pattern with claude-code nodes uses `{{upstream.fetch.result}}`. See [Templating](templating.md) for the reference.

## Try a bundled MCP example

```bash
# 1. Import tools from the modern-graphics MCP server (requires docker + image)
# Go to /tools/mcp/import in the dashboard and paste the docker config.
# See docs/mcp.md for the exact paste payload.

# 2. Run the example agent
sua workflow run graphics-creator-mcp \
  -i TOPIC="Q2 growth wins" \
  -i AUDIENCE="investors"
```

## Where to next

- [Agent YAML reference](agents.md) — every field, what it does
- [Flow control](flows.md) — conditional, switch, loop, agent-invoke
- [Tools](tools.md) — built-in tools + MCP + user-authored
- [Output widgets](output-widgets.md) — make runs render as polished UI
- [Dashboard tour](dashboard.md) — every page explained
- [Templating](templating.md) — placeholders in shell and claude-code
- [MCP servers](mcp.md) — import, manage, delete
