# @some-useful-agents/dashboard

Web dashboard for some-useful-agents. Server-rendered HTML, no bundler, no framework. Dark mode by default, JetBrains Mono, warm stone neutrals.

## Features

- **Pulse** — information radiator at `/pulse`. Signal tiles show agent output as live widgets. 10 display templates including `widget` (mirrors the agent's own outputWidget schema). Drag-and-drop layout, edit mode, widget palette, auto-theming. System metric tiles. Markdown rendering, YouTube media player, tile collapse/expand.
- **Agents** — card grid with **User / Examples / Community tabs**, filtering (status, search), sorting (name, status, recent, starred), pagination. 5-tab detail page: Overview (DAG viz, stats), Nodes (edit/delete/add), Config (variables, output widget, signal, secrets, status), Runs (history), YAML (editor).
- **Output widget editor** — at `/agents/:id/config`: visual cards for 5 widget types (raw, key-value, diff-apply, dashboard, **ai-template**), 5 load-example starters, live preview, per-type helper copy, and an **AI template** flow that calls Claude to generate sanitized HTML from a plain-English prompt.
- **Tools** — **User / Built-in tabs** with per-tab counts, filtering, pagination.
- **MCP import** (`/tools/mcp/import`) — paste a Claude-Desktop / Cursor `mcpServers` config, or quick-add by URL for HTTP servers. Discovers tools in parallel, grouped picker.
- **MCP server settings** (`/settings/mcp-servers`) — list imported servers with tool counts, enable/disable, cascade delete.
- **Build from goal** — describe what you want in plain language. The builder wizard designs a complete agent YAML with the right nodes, tools, inputs, and signal block.
- **Suggest improvements** — AI-powered agent review. "Apply now" saves directly, auto-fixes shell template mistakes. Available from failed run pages with the error pre-filled.
- **Runs** — filter by agent/status, paginate, replay from any node, resolved variables panel, real-time turn progress for LLM nodes
- **Settings** — secrets CRUD with passphrase unlock, global variables, MCP servers, MCP token rotation
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
