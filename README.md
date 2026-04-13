# some-useful-agents

A local-first agent playground. Author, schedule, and report on agents running on your machine.

Define agents in YAML, run them via CLI or MCP, schedule them with Temporal, chain them into pipelines, and share them with the community.

## Quick start — from npm, no clone

```bash
npm install -g @some-useful-agents/cli
mkdir my-agents && cd my-agents
sua init           # scaffolds agents/local/hello.yaml
sua tutorial       # 5-stage walkthrough ending with a scheduled dad joke
```

If you prefer running without global install, use `npx @some-useful-agents/cli <command>` anywhere.

The tutorial ends with you having built the `dad-joke` agent, fetched a real joke from
icanhazdadjoke.com, and optionally scheduled it to fire daily at 9am. Stages can be
enriched on-demand with a Claude or Codex deep-dive — type `explain` at any prompt.

## Cloning from source (for contributors)

```bash
git clone https://github.com/gregmeyer/some-useful-agents.git
cd some-useful-agents
npm install
npm run build
```

## Running on Temporal

```bash
# 1. Start Temporal server (Docker)
docker compose up -d

# 2. Start the worker (on your host, so it has shell + Claude CLI access)
sua worker start

# 3. In another terminal, submit a run
sua agent run hello-shell --provider temporal

# 4. See the workflow in the Temporal UI
open http://localhost:8233
```

The worker runs on the host (not in Docker) because agents need access to your shell
and `claude` CLI. Temporal itself is the only service running in Docker.

## What is this?

**some-useful-agents** lets you:

- **Author** agents as simple YAML files (shell commands or Claude Code prompts)
- **Run** them via a CLI (`sua`) or MCP server
- **Schedule** them with Temporal (or n8n, coming soon)
- **Chain** them into pipelines where one agent's output feeds the next
- **Share** them with the community via GitHub

## Architecture

```
HOST MACHINE
+-------------------------------------------------------------+
|                                                               |
|  CLI (sua)    MCP Server (HTTP/SSE)    Temporal Worker        |
|      |              |                       |                 |
|      +--------------+-----------------------+                 |
|                     v                                         |
|              packages/core                                    |
|   AgentLoader -> Provider Interface -> RunStore (SQLite)      |
|        |              |                    |                   |
|   agents/*.yaml  LocalProvider        data/runs.db            |
|                  TemporalProvider                              |
|                                                               |
|  Dashboard (Express:3000)    Agent Execution                  |
|  REST API + static HTML      +- shell: Docker sandbox         |
|                               +- claude: host (trusted)       |
+---------------------------+-----------------------------------+
                            | localhost:7233 (gRPC)
                 +----------v----------+
                 |      DOCKER          |
                 |  Temporal Server     |
                 |  (SQLite, :8233)     |
                 +---------------------+
```

## Agent definition format

```yaml
name: daily-summary
description: Summarize today's git activity
type: shell
command: "git log --since='1 day ago' --oneline"
timeout: 30
author: your-github-handle
version: "1.0.0"
tags: [git, summary]
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full schema.

## Packages

| Package | Description |
|---------|-------------|
| `@some-useful-agents/core` | Types, schemas, agent loader, run store |
| `@some-useful-agents/cli` | CLI tool (`sua`) |
| `@some-useful-agents/mcp-server` | MCP server (HTTP/SSE) |
| `@some-useful-agents/temporal-provider` | Temporal workflow provider |
| `@some-useful-agents/dashboard` | Web dashboard |

## Where is this going?

See [ROADMAP.md](ROADMAP.md) for direction, and [docs/adr/](docs/adr/) for the
rationale behind past architecture decisions.

## License

MIT
