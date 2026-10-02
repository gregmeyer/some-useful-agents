# Quickstart

30 minutes to your first running agent. If you want the 90-second summary: install, `sua init`, `sua agent run hello`, `sua dashboard start`. Open `http://127.0.0.1:3000/`.

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
- `agents/examples/` — data files the bundled examples read. In a repo checkout
  it also holds the 40+ example agent YAMLs themselves; on an npm install those
  ship inside the `@some-useful-agents/core` package instead. Either way all of
  them are auto-installed into the DB by `sua init`. Start with the curated
  three at **/start** rather than the full list.
- `data/runs.db` — SQLite DB for runs, agents, tools, MCP servers
- `.sua/` — local config (variables, MCP token)

Check what landed:

```bash
sua agent list              # see the agents you have
sua tool list               # see builtin + user tools
sua doctor                  # verify prerequisites + file perms
```

## Run your first agent

`hello` is the simplest bundled agent — one shell node that echoes.

```bash
sua agent run hello
```

Output:

```
▶ hello #1 (running)
✔ main: hello world
✔ hello completed in 42ms
```

Re-run it a few times, then look at the history:

```bash
sua agent list              # each agent with its last run
sua workflow logs <runId>   # one run's node-by-node output
```

## Open the dashboard

```bash
sua dashboard start
```

The first line of output prints a one-time sign-in URL with your bearer token in the fragment:

```
http://127.0.0.1:3000/auth#token=<64 chars>
```

Click it — the dashboard stores the cookie and bookmarks `http://127.0.0.1:3000/` as your landing page. Lost the link? `sua dashboard signin-url` prints it again.

From here you can:

- Start on `/start` — four starter agents, one per pattern
- Browse agents on `/agents` (tabs: User / Examples / Community) and run one from its card
- Watch a run live at `/runs/:id`: each node's output, tool calls, cost and budget
- Talk to an agent on its **Chat** tab; replies stream in as they're written
- See every agent's latest result on **Pulse** (`/pulse`), run any tile in place, and arrange it with **✎ Arrange**; or describe a whole board with **＋ New board** and sua builds it from your agents ([Boards](boards.md))
- Answer agents' questions and review failures in your inbox at `/`

## Create your own agent

### From the dashboard (recommended)

1. `/agents/new` — fill in a name (the id fills itself in) and pick the first node's type
2. Click Create → you land on the agent; click **Run now**
3. Add more nodes on the Nodes tab, wire them on the graph, save

Or use **Build from goal** — describe what you want in plain English and sua designs the agent YAML (and dashboard tiles, for bigger goals) for you, with a structural critic checking each draft before you see it. See [Build from a goal](build-from-goal.md).

### Give it a goal instead of steps

For open-ended asks ("find the three best-reviewed trail shoes under $150"), skip wiring a flow: add a **goal** node with the tools it may use and a budget, and the model works it out.

```yaml
nodes:
  - id: research
    type: goal
    goal: "Find the three best-reviewed trail running shoes under $150 and say why."
    tools: [web-fetch, http-get]
    budget: { maxTurns: 10, timeoutSec: 300 }
```

The run page shows the turns, tool calls and time it used. See [Goal agents](goal-agents.md).

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
sua agent run hello-mine -i TOPIC="world"
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
sua agent run two-step
```

Same pattern with llm-prompt nodes uses `{{upstream.fetch.result}}`. See [Templating](templating.md) for the reference.

## Try a bundled MCP example

```bash
# 1. Import tools from the modern-graphics MCP server (requires docker + image)
# Go to /tools/mcp/import in the dashboard and paste the docker config.
# See docs/mcp.md for the exact paste payload.

# 2. Run the example agent
sua agent run graphics-creator-mcp \
  -i TOPIC="Q2 growth wins" \
  -i AUDIENCE="investors"
```

## Where to next

- [Agent YAML reference](agents.md) — every field, what it does
- [Goal agents](goal-agents.md) — a model with a goal, tools and a budget
- [Conversations](conversations.md) — chat with an agent and follow up
- [Cost](cost.md) — what runs cost, and spend limits
- [Tool policies](tool-policies.md) — control which tools agents can use
- [A2UI views](a2ui-views.md) — describe how an agent's results look
- [Flow control](flows.md) — conditional, switch, loop, agent-invoke
- [Tools](tools.md) — built-in tools + MCP + user-authored
- [Output widgets](output-widgets.md) — make runs render as polished UI
- [Dashboard tour](dashboard.md) — every page explained
- [Templating](templating.md) — placeholders in shell and llm-prompt
- [MCP servers](mcp.md) — import, manage, delete
