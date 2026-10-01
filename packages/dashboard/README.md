# @some-useful-agents/dashboard

Web dashboard for some-useful-agents. Server-rendered HTML, no bundler, no framework. Dark mode by default, JetBrains Mono, warm stone neutrals.

## Features

- **Pulse & dashboards** — the board of agent tiles at `/pulse` (grouped by recent use; every tile has Run) plus named, sectioned `/dashboards/:id`. 13 display templates including `widget`; all widgets are drawn with A2UI. Drag-and-drop layout, edit mode (persists across reloads, with a navigate-away guard), in-place "+ Add tile" modal, widget palette, auto-theming. System metric tiles. Markdown rendering, YouTube media player, tile collapse/expand.
- **Tiles that run themselves** — an agent runs once automatically when first added to a dashboard, "Run again" refreshes the tile in place, and a one-click modal allows CSP-blocked widget image hosts.
- **Improve layout wizard** — on `/pulse` or any named dashboard: proposes what to surface, which installed agents to add (Path A), and which new agents to draft inline (Path B).
- **Integrations** (Tools → Integrations, `/tools?tab=integrations`) — tabbed UI for CSV / Postgres / SQLite / Gmail (OAuth) kinds and Slack / webhook / file destinations; data-source kinds auto-generate query tools.
- **Agents** — card grid with **User / Examples / Community tabs**, filtering (status, search), sorting (name, status, recent, starred), pagination. 5-tab detail page: Overview (DAG viz, stats), Nodes (edit/delete/add), Config (variables, output widget, signal, secrets, status), Runs (history), YAML (editor).
- **Output widget editor** — at `/agents/:id/config`: visual cards for 5 widget types (raw, key-value, diff-apply, dashboard, **ai-template**), 5 load-example starters, live preview, per-type helper copy, and an **AI template** flow that calls Claude to generate sanitized HTML from a plain-English prompt.
- **Tools** — **Imported / Built-in / Servers / Integrations** tabs with counts, filtering, pagination.
- **MCP import** (`/tools/mcp/import`) — paste a Claude-Desktop / Cursor `mcpServers` config, or quick-add by URL for HTTP servers. Discovers tools in parallel, grouped picker.
- **MCP servers** (Tools → Servers) — list imported servers with tool counts, enable/disable, cascade delete.
- **Build from goal** — describe what you want; the wizard drafts agents (a goal node or a fixed flow, with a diagram and why), lets you switch the shape and **Try it** before keeping it.
- **Chat** — talk to an agent on its Chat tab; replies stream over a WebSocket, and agents with a `view:` reply with widgets whose buttons send the next message. Inbox threads use the same connection.
- **A2UI views** — an agent's `view:` (or its converted output widget) draws on the run page, Pulse, dashboards, inbox and chat.
- **Suggest improvements** — AI-powered agent review. "Apply now" saves directly, auto-fixes shell template mistakes. Available from failed run pages with the error pre-filled.
- **Runs** — filter by agent/status, paginate, replay from any node, resolved variables panel, real-time turn progress for LLM nodes
- **Settings** — Secrets, Variables, Claude Desktop (MCP token), LLM providers, Usage (cost + spend limits), Policies (edit + test the tool policy), Temporal, Appearance (themes, widget renderer), General
- **LLM options** — agent-level provider (Claude, Codex, OpenAI-compatible, Apple) and model defaults, plus per-node `model` / `maxTurns` / `allowedTools` on the forms (`llm-prompt` nodes; `claude-code` alias still accepted)
- **Design system** — DESIGN.md source of truth. Dark mode default, JetBrains Mono headings, warm stone neutrals, teal accent.

## Start

```bash
sua dashboard start --port 3000
```

The dashboard shares the MCP bearer token (`~/.sua/mcp-token`) for auth. A one-time sign-in URL is printed on startup (`sua dashboard signin-url` prints it again); the session lasts 30 days of inactivity.

See the [main repo README](https://github.com/gregmeyer/some-useful-agents) for full documentation.

## License

MIT
