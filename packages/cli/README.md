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

- **Integrations (v0.21)** — connect a data source at `/settings/integrations` and get tools for free: CSV / Postgres / SQLite kinds auto-generate find/count tools, Gmail connects via OAuth, and `notify` handlers reference saved Slack / webhook / file destinations by id.
- **Improve layout wizard (v0.21)** — on `/pulse` or any named dashboard, sua proposes what to surface, which installed agents to add (Path A), and which new agents to draft inline (Path B).
- **Build from goal, orchestrated (v0.21)** — a `goal-surveyor` + per-fragment `agent-drafter` (each behind its own critic) + `dashboard-designer` design a complete plan from a plain-language goal; already-covered goals return "Nothing to build", partial failures show a partial-success screen.
- **`llm-prompt` node type (v0.21)** — canonical rename of `claude-code` (alias preserved). Set `provider` (claude/codex), `model`, `maxTurns`, and `allowedTools` per node, or as agent-level defaults nodes inherit.
- **Output widgets (v0.21)** — `replay` / `field-toggle` / `view-switch` / `sort` / `filter` / `paginate` controls render everywhere and are restylable; first-class `table` field type; `interactive` widgets re-run in place.
- **MCP servers as first-class** — paste a `mcpServers` config at `/tools/mcp/import`, sua discovers tools and imports them in bulk. Manage + enable/disable + delete from `/settings/mcp-servers`.
- **Pulse dashboard** — `/pulse` shows a live information radiator with signal tiles from your agents. 10 display templates including `widget` (mirrors the agent's outputWidget).
- **Flow control** — conditional, switch, loop, agent-invoke, branch, end, break nodes.
- **15 example agents** — from hello world to MCP-driven graphics generation.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) and [docs/](https://github.com/gregmeyer/some-useful-agents/tree/main/docs) for full documentation.

## License

MIT
