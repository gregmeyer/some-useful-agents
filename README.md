# some-useful-agents

A local-first agent playground. Author, schedule, and report on agents running on your machine.

Define agents in YAML, run them via CLI or MCP, schedule them with Temporal, chain them into pipelines, and share them with the community.

## Quick start

```bash
git clone https://github.com/gregmeyer/some-useful-agents.git
cd some-useful-agents
npm install
npm run build
npx sua init
npx sua agent run hello-shell
```

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

## License

MIT
