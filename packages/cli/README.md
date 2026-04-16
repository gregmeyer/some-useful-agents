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
- `sua mcp` — start, rotate-token, token
- `sua schedule` — list, validate
- `sua dashboard` — start
- `sua init`, `sua doctor`, `sua tutorial`

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
