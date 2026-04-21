# @some-useful-agents/dashboard

Web dashboard for some-useful-agents. Server-rendered HTML, no bundler, no framework. Dark mode by default, JetBrains Mono, warm stone neutrals.

## Features

- **Pulse** — information radiator at `/pulse`. Signal tiles show agent output as live widgets. 9 display templates (metric, text-headline, table, status, time-series, image, text-image, media). Container layout with drag-and-drop, edit mode, widget palette, auto-theming by template type. Conditional color thresholds. System metric tiles (runs today, failure rate, avg duration, agents). Markdown rendering, YouTube media player, tile collapse/expand.
- **Agents** — card grid with filtering (status, source, search), sorting (name, status, recent, starred), pagination. 5-tab detail page: Overview (DAG viz, stats), Nodes (edit/delete/add), Config (LLM defaults, variables, secrets, status), Runs (history), YAML (editor).
- **Build from goal** — describe what you want in plain language. The builder wizard designs a complete agent YAML with the right nodes, tools, inputs, and signal block.
- **Suggest improvements** — AI-powered agent review. "Apply now" saves directly, auto-fixes shell template mistakes. Available from failed run pages with the error pre-filled.
- **Tools** — browse built-in + user tools with filtering and pagination
- **Runs** — filter by agent/status, paginate, replay from any node, resolved variables panel, real-time turn progress for LLM nodes
- **Settings** — secrets CRUD with passphrase unlock, global variables, MCP token rotation
- **LLM defaults** — agent-level provider (Claude/Codex) and model selection with dropdown UI
- **Design system** — DESIGN.md source of truth. Dark mode default, JetBrains Mono headings, warm stone neutrals, teal accent.

## Start

```bash
sua dashboard start --port 3000
```

The dashboard shares the MCP bearer token (`~/.sua/mcp-token`) for auth. A one-time sign-in URL is printed on startup.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
