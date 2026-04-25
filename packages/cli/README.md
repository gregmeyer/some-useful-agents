# @some-useful-agents/cli

Command-line interface for some-useful-agents. Author, run, schedule, and manage agents from the terminal.

## Install

```bash
npm install -g @some-useful-agents/cli
```

## Quick start

```bash
sua init                         # initialize a project
sua workflow run hello           # run an agent
sua tool list                    # see available tools
sua examples install             # install bundled examples
sua dashboard start              # open the web dashboard
```

## Commands

- `sua agent` — list, new, run, status, logs, cancel, audit, edit, disable/enable
- `sua workflow` — list, run, replay, import, export, status, logs
- `sua tool` — list, show, validate
- `sua examples` — install, remove, list
- `sua secrets` — set, get, list, delete, migrate, check
- `sua vars` — list, get, set, delete (global variables)
- `sua mcp` — start, rotate-token, token
- `sua schedule` — list, validate
- `sua dashboard` — start
- `sua init`, `sua doctor`, `sua tutorial`

## Recent highlights

- **MCP servers as first-class (v0.18)** — paste a `mcpServers` config at `/tools/mcp/import`, sua discovers tools and imports them in bulk. Manage + enable/disable + delete from `/settings/mcp-servers`.
- **AI-generated output widgets (v0.18)** — `ai-template` widget type: describe a layout in English, Claude generates sanitized HTML; per-run values substitute at render time.
- **Build from goal** — `sua dashboard start`, click "Build from goal". The builder designs a complete agent YAML with the right nodes, tools, and wiring.
- **Pulse dashboard** — `/pulse` shows a live information radiator with signal tiles from your agents. 10 display templates including `widget` (mirrors the agent's outputWidget).
- **Agent-level LLM defaults** — set `provider: codex` and `model: o4-mini` at the agent level. Nodes inherit unless they override.
- **Flow control** — conditional, switch, loop, agent-invoke, branch, end, break nodes.
- **10 built-in tools** — shell-exec, claude-code, http-get/post, file-read/write, json-parse/path, template, csv-to-chart-json.
- **15 example agents** — from hello world to MCP-driven graphics generation.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) and [docs/](https://github.com/gregmeyer/some-useful-agents/tree/main/docs) for full documentation.

## License

MIT
