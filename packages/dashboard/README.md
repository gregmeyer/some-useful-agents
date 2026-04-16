# @some-useful-agents/dashboard

Web dashboard for some-useful-agents. Server-rendered HTML, no bundler, no framework.

## Features

- **Agents** — card grid, DAG visualization, click-to-replay, per-node action dialogs
- **Tools** — browse built-in + user tools, inspect inputs/outputs
- **Runs** — filter, paginate, nested run linking, replay from any node
- **Settings** — secrets CRUD with passphrase unlock, MCP token rotation
- **Tutorial** — 7-step guided walkthrough with inline scaffold actions
- **Template palette** — autocomplete for `$` and `{{` in node command/prompt editors

## Start

```bash
sua dashboard start --port 3000
```

The dashboard shares the MCP bearer token (`~/.sua/mcp-token`) for auth. A one-time sign-in URL is printed on startup.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
