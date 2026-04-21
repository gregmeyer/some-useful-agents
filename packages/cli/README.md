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

## v0.16.0 highlights

- **Build from goal** — `sua dashboard start`, click "Build from goal", describe what you want. The builder designs a complete agent YAML with the right nodes, tools, and wiring.
- **Pulse dashboard** — `/pulse` shows a live information radiator with signal tiles from your agents. 9 display templates, drag-and-drop layout, auto-theming.
- **Agent-level LLM defaults** — set `provider: codex` and `model: o4-mini` at the agent level. Nodes inherit unless they override.
- **Flow control** — conditional, switch, loop, agent-invoke, branch, end, break nodes.
- **9 built-in tools** — shell-exec, claude-code, http-get/post, file-read/write, json-parse/path, template.
- **13 example agents** — from hello world to conditional routing to AI-powered analysis.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
