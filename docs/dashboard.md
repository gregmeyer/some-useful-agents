# Dashboard tour

Every page, what it's for, when to use it.

Start the dashboard with `sua dashboard start`. The first startup prints a one-time sign-in URL with the bearer token in the fragment (e.g. `http://127.0.0.1:3000/auth#token=…`). Click it once; the dashboard stores an HttpOnly cookie and you bookmark `http://127.0.0.1:3000/`.

Dark mode by default. JetBrains Mono. The design system source-of-truth is [DESIGN.md](../DESIGN.md).

## `/` — Home feed

What's happening right now. Shows:

- **Today's stats** — runs today, total runs, in-flight count, scheduler status
- **Recent activity** — paginated feed of runs with agent link, status, duration
- **Scheduled today** — agents with cron expressions, next-fire time
- **Getting started** — the tutorial CTA if you're new

Good landing page when you want "what shipped since I last looked."

## `/agents` — Agents list

**Tabs:** User / Examples / Community (with per-tab counts). Community hidden unless you have community agents imported.

Each card shows: status badge, source, optional `mcp` badge, "used by N" badge if other agents invoke this one, DAG shape (dot string), description, node count, schedule (humanized), last run status + age, **Run** button. Star toggle on each card.

**Filters** — search (id/name/description), status (active/paused/draft/archived), sort (name / status / recently run / starred first). Pagination with 12/24/48/100 page sizes.

**Build from goal** — describe an agent in plain English, Claude designs the full YAML. Opens a modal.

**New agent** — interactive scaffolder at `/agents/new`.

## `/agents/:id` — Agent detail

Five tabs:

### Overview
- DAG visualization (Cytoscape, click any node for actions)
- Latest run's output widget (if declared)
- Stats strip: total runs, success rate, avg duration
- Signal + output widget previews

### Nodes
Edit / delete / add nodes inline. Template palette autocomplete for upstream fields + inputs + vars. Per-node timeout, env, secrets, onlyIf predicates.

### Config
Settings grouped by area:

- **Status** — active / paused / archived / draft
- **LLM defaults** — agent-level provider (claude/codex) and model, inherited by claude-code nodes
- **Schedule** — cron expression, humanized preview
- **Signal** — Pulse tile config (title, icon, template, mapping)
- **Variables** — agent inputs: name, type (string/number/boolean/enum), required, default, description. Enum types get a values column
- **Output Widget** — see [Output Widget editor](#output-widget-editor) below
- **Secrets** — declared secrets list + set/missing status

### Runs
Paginated run history. Filter by status. Click any row for per-node stdout/exit codes/errors. "Replay from node" button re-runs starting at any node, reusing upstream outputs.

### YAML
Editor for the raw YAML. Zod validation on save. Versioned — each save creates a new `agent_versions` row.

## Output widget editor

At `/agents/<id>/config` under **Output Widget**. The core loop:

1. **Pick a card** — 5 widget types (raw / key-value / diff-apply / dashboard / ai-template). Each card shows an ASCII layout hint and a one-line description.
2. **Read the helper** — a paragraph under the picker explains which field types work for the selected widget and how field names are matched against the run output.
3. **Declare fields** — name, optional label, type. The type dropdown shows tooltips on hover; types incompatible with the selected widget are dimmed with `(n/a)`.
4. **Or load an example** — 5 one-click starters (Report card, Metric dashboard, File preview, Diff applier, Key-value summary).
5. **Or use AI** — pick `ai-template`, write a prompt, click Generate. A modal with a spinner + elapsed-seconds counter + Cancel button shows progress. Sanitized HTML appears in an editable textarea.
6. **Preview** — live preview card rerenders as you edit (debounced 200ms).
7. **Save** — persists to the agent's DB row.

See [Output widgets](output-widgets.md) for the full reference.

## `/tools` — Tools list

**Tabs:** User / Built-in (per-tab counts).

**User tab** shows tools imported from MCP servers or authored locally. **Built-in tab** shows the 10 builtins that ship with the runtime.

Each card shows tool id, source badge (local / examples / community / builtin), implementation type badge (shell / claude-code / builtin / mcp), description, input + output counts.

**Import from MCP server** CTA in the page header → `/tools/mcp/import`.

See [Tools](tools.md) for the full catalog.

## `/tools/:id` — Tool detail

Read-only reference: inputs + outputs tables, implementation details (command, prompt, builtinName, or MCP transport+command+toolName). For MCP tools, links back to `/settings/mcp-servers` for the source server.

## `/tools/mcp/import` — MCP import

Two paths on one page:

- **Quick add by URL** — for HTTP MCP servers. Name + URL. One click.
- **Paste full config** — Claude-Desktop / Cursor `mcpServers` map, bare map, or single-server shape. Accepts JSON or YAML.

Click Discover → server opens, lists tools in parallel, you pick which to import, click Create. See [MCP servers](mcp.md) for the full flow.

## `/runs` — Runs list

Every run across all agents. Filter by agent, status (pending / running / completed / failed / cancelled). Paginated. Click a row for run detail.

## `/runs/:id` — Run detail

Per-node execution table with stdout, exit codes, errors, timings. For claude-code nodes, real-time turn progress via stream-json. "Replay from node" button on each row.

Resolved variables panel shows what values the run actually saw (inputs after defaults, vars after substitution).

## `/pulse` — Pulse

Information radiator with draggable signal tiles. Each agent with a `signal:` block gets a tile.

**10 templates:** `metric`, `time-series`, `text-headline`, `text-image`, `image`, `table`, `status`, `media`, `widget`, `comparison`, `key-value`, `story`, `funnel`.

**`template: widget`** is special — mirrors the agent's own outputWidget. No mapping required.

Configure tiles via the ⚙ gear on each one. Hide/unhide via the × or eye icon. System metric tiles (runs today, avg duration, failure rate, agent count) pin to the top.

## `/settings`

Tabs: Secrets, Variables, **MCP Servers**, Integrations, Appearance, General.

### Secrets
Encrypted-at-rest store (scrypt + AES-256-GCM). Unlock with passphrase, set/delete secrets, copy-before-save modal for newly created secrets.

### Variables
Global plain-text values. CRUD with values visible. Referenced as `$NAME` / `{{vars.NAME}}`.

### MCP Servers
List of imported MCP servers with tool counts, **Enable/Disable** toggle (gates every tool from that server), **Delete** (cascades). Add new servers via `/tools/mcp/import`. See [MCP servers](mcp.md).

### General
MCP token rotation, data paths, retention, scheduler heartbeat.

## `/help`

CLI reference grouped by purpose. Each command shows a "Where in the UI" link when equivalent dashboard action exists. Links to user guides on GitHub (quickstart, agents, flows, tools, mcp, output widgets, templating, dashboard).

## `/help/tutorial`

7-step progress-tracked walkthrough. Scaffolds a hello agent, runs it, adds a second node, explores secrets, etc. Progress reflects your actual project state.

## Related

- [Quickstart](quickstart.md) — first-touch walkthrough
- [Agents reference](agents.md) — every YAML field
- [Output widgets](output-widgets.md) — widget types + AI templates
- [MCP servers](mcp.md) — import + lifecycle
