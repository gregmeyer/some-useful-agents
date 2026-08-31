# Dashboard tour

Every page, what it's for, when to use it.

Start the dashboard with `sua dashboard start`. The first startup prints a one-time sign-in URL with the bearer token in the fragment (e.g. `http://127.0.0.1:3000/auth#token=…`). Click it once; the dashboard stores an HttpOnly cookie and you bookmark `http://127.0.0.1:3000/`.

### Staying signed in

The session is an **idle** window — it renews on every page you load, so using
the dashboard keeps you signed in. The default is 30 days of inactivity; set
`SUA_DASHBOARD_SESSION_HOURS` to change it. Details and the security rationale
are in [SECURITY.md § Dashboard session lifetime](SECURITY.md) and
[ADR-0033](adr/0033-idle-dashboard-session.md).

If a session does lapse, the page says so and the tab shows a "You have been
signed out" banner rather than quietly failing. To sign in again you need a
fresh link, because `sua dashboard start` prints one only at boot:

```bash
sua dashboard signin-url
```

Run it on the machine hosting the dashboard and open the link it prints. That
link carries the bearer token, so treat it like a password — and note that
`sua mcp rotate-token` invalidates every existing session immediately.

Dark mode by default. JetBrains Mono. The design system source-of-truth is [DESIGN.md](../DESIGN.md).

The footer shows a **build stamp** (`sua vX · <sha>`) so you can tell which build the running daemon is serving; `-dirty` means uncommitted changes were in the build tree. The same stamp is exposed at `GET /health` as `{ commit, builtAt }`. See [Build from a goal § Build stamp](build-from-goal.md#build-stamp).

## Navigation

The top bar leads with the daily-driver surfaces: `sua · Inbox · Agents · Settings · Help`. The `sua` brand IS the home link → `/`, the single dashboard surface (it tints when you're there); there's no separate "Home" item. **Agents** links to the agents list and groups the building blocks and executions — on each of those landing pages an in-page tab strip (**Agents · Tools · Nodes · Runs · Packs · Scheduled**) sits under the page header, mirroring the Settings tabs, with the current page highlighted. There's no separate global subnav bar. URLs are unchanged (`/agents`, `/tools`, `/nodes`, `/runs`, `/packs`, `/scheduled`); the grouping just keeps the top bar uncluttered.

## `/` — Mission Control home

The single dashboard surface. Top to bottom:

- **Ask sua →** — the primary CTA in the header opens a fresh inbox thread
  (`POST /inbox/new`), so the home's main action is "ask sua to run, build, fix,
  or look something up." (Distinct from the top-bar toast, which is for reviewing
  what's already waiting.) With no agents installed the page is the
  Build-from-goal empty state instead.
- **Live Pulse** — the live board (system metric tiles + per-agent signal
  tiles), fully editable here: configure/hide tiles, drag to reorder, Edit
  layout, Improve layout. The **dashboards dropdown** in the board header
  switches to named/pack dashboards (`/dashboards/:id`); "Default Dashboard"
  is this home board.
- **Recent activity** — the paginated run feed, collapsed by default.

This replaced the old system-stat-only home (a strict subset of Pulse) AND the
separate `/pulse` page — there's now **one** dashboard surface. `/pulse` 302-
redirects to `/`; its sub-routes (tile fragments, hide/show-all, layout planner)
are unchanged.

The **"needs you" signal lives in the top bar**, not on the home: an amber
**"N need your reply →"** toast appears in the top-bar empty space (on every
page) whenever inbox threads are awaiting your reply — count from
`/inbox/needs-you-count`, polled ~30s, hidden when zero. Click it to go to the
inbox.

## `/agents` — Agents list

**Tabs:** User / Examples / Community (with per-tab counts). Community hidden unless you have community agents imported.

Each card shows: status badge, source, optional `mcp` badge, **"used by N"** if other agents invoke this one and **"calls N"** if it invokes others, DAG shape (dot string), description, node count, schedule (humanized), last run status + age, **Run** button. Star toggle on each card.

**Filters** — search (id/name/description), status (active/paused/draft/archived), sort (name / status / recently run / starred first). Pagination with 12/24/48/100 page sizes.

**Calls other agents (N)** — a chip beside the filters narrows the list to agents that run other agents as part of their job. The count is scoped to the current tab and search, so it predicts what clicking returns. Agents calling agents is the multi-agent story: sua ships `agent-invoke` and `loop`-over-agent node types, and its own Build-from-goal is one of these — `goal-surveyor` → parallel `agent-drafter`s → `dashboard-designer`.

**Build from goal** — describe what you want in plain English; an orchestrator runs goal-surveyor → agent-drafter(s) → dashboard-designer to design the full YAML and tiles. Opens a modal. See [Build from a goal](build-from-goal.md).

**New agent** — interactive scaffolder at `/agents/new`.

## `/scheduled` — Scheduled agents

Sibling tab in the Agents strip (Agents · Tools · Nodes · Runs · Packs · **Scheduled**). Lists every agent with a `schedule:` field — regardless of status — so paused-but-scheduled and draft-with-cron agents are visible alongside active ones. Sorted by next-fire (earliest first), with id as the tiebreaker.

**Columns:** Agent (id + truncated description) · Status (badge) · Schedule (humanized cron, raw on hover) · Last fire · Next fire · Actions.

**Per-row actions:**

| Row status | Button | What it does |
|---|---|---|
| `active` | **Pause** | Sets status=`paused`. Cron stays declared so Resume restores firing one click later. Reversible. |
| `paused` | **Resume** | Sets status=`active`. Scheduler starts firing the next cron tick. |
| `draft` | **Activate** | Sets status=`active`. First-time activation for an agent that was authored but never turned on. Same semantic as Resume but different copy ("Activated" vs "Resumed"). |
| `archived` | — | No row action. Use Edit. |

Every row also has an **Edit** link to `/agents/:id/config` for cron changes or permanent clearing (clearing is intentionally not a one-click row action — it's less reversible than Pause).

**Inline hints in the Next fire column** (the page reads as transparently as possible):

- `active` → formatted relative time (`9h`, `2d`).
- `draft` → `won't fire — status is draft` (cursor-help; tooltip explains the active-only rule).
- `archived` → `won't fire — archived`.
- `paused` → `—` (cron paused-by-intent; Resume restores).

**`never` in Last fire** has a tooltip clarifying that the column counts only `triggeredBy='schedule'` runs — manual runs via dashboard / CLI / MCP don't count here. An agent run manually but never by the scheduler shows `never` by design.

**The home Scheduled widget** mirrors this surface: includes paused agents (badged), shows Pause/Resume inline, and has a "View all →" link to this page.

## `/agents/:id` — Agent detail

Five tabs:

### Overview
- **DAG visualization** — Cytoscape canvas with wheel-zoom + drag-pan. A floating toolbar in the bottom-right has **+** (zoom in), **⧇** (fit to view), and **−** (zoom out) buttons; clicks bind to `cy.zoom()` / `cy.fit()`. The canvas height adapts to graph size — 380px default, 240px compact for 1–2-node DAGs — so a small graph doesn't drown in an empty grid and a dense one stays readable without leaving the page. Click any node for the action dialog (Edit, Replay-from-here, Jump to details).
- **Edit wiring** — toggles the canvas into a wiring editor. Drag one node onto another to make the second depend on the first, or click a source node then a target if you'd rather not drag. Click an edge to remove it. **Save wiring** writes every change as a *single* new version, so restructuring five nodes is one entry in history rather than five. Cycles are refused (with the path that closes the loop), and so is cutting an edge whose downstream still reads `{{upstream.x.result}}` or `$UPSTREAM_X_RESULT` — those would crash the node. Cutting one that an `onlyIf` predicate still names saves with a warning, because it does not crash, it just quietly changes which branch runs. Run detail's DAG is never editable: it's a record of what happened.
- **Agent calls** — what this agent invokes and what invokes it, each linked, with the node that does the calling. A target chosen at run time (e.g. `{{inputs.LOGGER_AGENT_ID}}`) is shown as "chosen at run time" rather than a dead link; one naming an agent that no longer exists is badged `missing`. The section is omitted entirely for agents that neither call nor are called.
- Latest run's output widget (if declared)
- Stats strip: total runs, success rate, avg duration
- Signal + output widget previews

### Nodes
Edit / delete / add nodes inline. Template palette autocomplete for upstream fields + inputs + vars. Per-node timeout, env, secrets, onlyIf predicates.

### Config
Settings grouped by area:

- **Status** — active / paused / archived / draft
- **LLM defaults** — agent-level provider (claude/codex) and model, inherited by `llm-prompt` nodes; per-node overrides for `model` / `maxTurns` / `allowedTools` live on the Nodes tab
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

**User tab** shows tools imported from MCP servers or authored locally. **Built-in tab** shows the tools that ship with the runtime (plus any tools auto-generated by integrations).

Each card shows tool id, source badge (local / examples / community / builtin), implementation type badge (shell / llm-prompt / builtin / mcp), description, input + output counts.

**Import from MCP server** CTA in the page header → `/tools/mcp/import`.

See [Tools](tools.md) for the full catalog.

## `/tools/:id` — Tool detail

Read-only reference: inputs + outputs tables, implementation details (command, prompt, builtinName, or MCP transport+command+toolName). For MCP tools, links back to `/tools?tab=servers` for the source server.

## `/tools/mcp/import` — MCP import

Two paths on one page:

- **Quick add by URL** — for HTTP MCP servers. Name + URL. One click.
- **Paste full config** — Claude-Desktop / Cursor `mcpServers` map, bare map, or single-server shape. Accepts JSON or YAML.

Click Discover → server opens, lists tools in parallel, you pick which to import, click Create. See [MCP servers](mcp.md) for the full flow.

## `/runs` — Runs list

Every run across all agents. Filter by agent, status (pending / running / completed / failed / cancelled). Paginated. Click a row for run detail.

## `/runs/:id` — Run detail

Per-node execution table with stdout, exit codes, errors, timings. For `llm-prompt` nodes, real-time turn progress via stream-json. "Replay from node" button on each row. The **Node execution** header (title + search input + status-filter dropdown) sticks at `top: 0` while node cards scroll under it; an rAF-throttled scroll observer releases the DAG/Result sticky bar above it back to `position: static` when this header reaches the release line, so the two sticky surfaces don't fight for the top of the viewport.

Resolved variables panel shows what values the run actually saw (inputs after defaults, vars after substitution).

**Cancel + abandoned errors.** A **Cancel** button appears while the run is `running` or `pending`. The cancel route SIGTERMs the spawned child and escalates to SIGKILL after 5s if the child hasn't exited, then finalizes both the run row and any still-`running` `node_executions` rows to `cancelled` with a flash banner. A separate `errorCategory: 'abandoned'` appears on rows the orphan reaper finalized on a later dashboard boot (i.e. a daemon restart killed the parent process mid-run); the run-level error names the cause inline. See [Security model § Orphan process reaper](SECURITY.md) for the mechanism.

## The board (lives on `/`)

> **Heads-up — the front door changed.** There used to be three overlapping
> landing surfaces: a stat-only Home (`/`), the Pulse board (`/pulse`), and the
> Inbox. They're now unified into **one** dashboard at `/` (see `/` above).
> **`/pulse` 302-redirects to `/`** — bookmarks still work, the nav item is gone
> (the `sua` brand is the home link), and the board is editable right on the
> home. The `/pulse/*` sub-routes (tile fragments, hide/show-all, layout planner)
> are unchanged. Below is the board reference — it all applies to the board on `/`.

The board is your agents at a glance, with draggable signal tiles. Each agent with a `signal:` block gets a tile.

**10 templates:** `metric`, `time-series`, `text-headline`, `text-image`, `image`, `table`, `status`, `media`, `widget`, `comparison`, `key-value`, `story`, `funnel`.

**`template: widget`** is special — mirrors the agent's own outputWidget. No mapping required.

**Tiles are grouped by how recently you used them** — Health (system metrics),
Recent (ran in the last 7 days, newest first), Idle, and Never run. Empty groups
are omitted. The ordering is meant for a run console: what you used last is what
you are most likely to run again, and agents you set up but never used are
collected at the bottom rather than scattered through the board.

Configure tiles via the ⚙ gear on each one. Hide/unhide via the × or eye icon (the × toggles the agent's `pulseVisible` flag). System tiles (runs today, avg duration, failure rate, agent count, **scheduler**) pin to the top.

**The scheduler tile** reports whether the schedule daemon is actually running,
because a dead scheduler is otherwise invisible here: `/health` knows and
`/scheduled` says so in its header, but that is the page you only open once you
already suspect something. Red means agents are scheduled and nothing will fire
them — the case that costs you runs. Amber covers the merely odd: the daemon off
with nothing scheduled, or alive but registered nothing (which is worse than
being visibly off — it reads as fine and never fires). `sua doctor` reports the
same state and exits non-zero on the red case.

**Every tile is runnable.** Each tile carries a **Run** button in its footer that
re-runs the agent and refreshes the tile in place — no navigation to the run
detail page. This includes tiles that have never run, which is the point: a tile
you set up but never used is the most useful thing on the board to be able to
start. Tiles whose body already offers a run control keep theirs instead — an
interactive widget's mini-app, or a widget tile's **Run again** — so no tile has
two. System metric tiles have none; there is no agent behind them.

An agent with a *required* input and no default shows **Run…**, linking to the
agent page where the full run form lives, rather than a one-click button that
would fail every time.

Without JavaScript the button still POSTs to `/agents/:id/run` and navigates to
the run, as before.

**Tiles run themselves.** Adding an agent to a dashboard runs it once automatically, so a freshly added tile is never blank. If a widget references an external image host blocked by the dashboard's CSP, the tile shows a one-click **allow** modal that appends the host to the agent's `permissions.imgSrc` allowlist.

**Improve layout** — wizard button on the home board and on any named dashboard (`/dashboards/:id`). It reads the current layout and proposes a tidier arrangement, surfaces installed agents that aren't here yet (Path A), and can draft brand-new agents inline (Path B). See [Build from a goal § Improve layout](build-from-goal.md#improve-layout-path-a--path-b).

**Dashboards dropdown** — in the board header; switches between the Default (home) board and any named dashboard, with a "New dashboard name" field to create one inline. Long names truncate with a tooltip. **+ Install from Packs** opens an in-place modal listing every registered-but-uninstalled pack with an Install button (you stay on the home board), plus a "Browse all packs →" link to the full [/packs](#packs--widget-packs) page.

## `/dashboards/:id` — Named dashboards

Named, sectioned views over installed agents — pack-owned (e.g. `starter:media`) or user-created. Render at `/dashboards/:id`, edit inline at `/dashboards/:id/edit` (rename the dashboard, add / remove / reorder sections and tiles, all server-rendered). Renaming changes only the display name — the dashboard's stable id is preserved (shown in the editor header), so delete and pack uninstall still match after a rename. The built-in "Default Dashboard" (the home board) has no stored row and can't be renamed. The **+ Add tile** modal is in-place and offers a blank agent or build-from-goal; edit mode persists across reloads and warns before you navigate away. Pack-owned dashboards are editable but not deletable (uninstall the pack) — their editor explains why and links to the owning pack's page, where Uninstall removes the pack's dashboards while keeping any contributed agents; user-created ones are deletable, and removing the last tile offers to delete the dashboard. Each named dashboard curates its own tile list independently of `pulseVisible`. The same tile behaviors as the home board apply (first-run auto-execution, in-place Run again, CSP image-allow).

## `/settings`

Tabs: Secrets, Variables, **MCP Servers**, Integrations, Appearance, General.

### Secrets
Encrypted-at-rest store (scrypt + AES-256-GCM). Unlock with passphrase, set/delete secrets, copy-before-save modal for newly created secrets.

### Variables
Global plain-text values. CRUD with values visible. Referenced as `$NAME` / `{{vars.NAME}}`.

### MCP Servers
List of imported MCP servers with tool counts, **Enable/Disable** toggle (gates every tool from that server), **Delete** (cascades). Add new servers via `/tools/mcp/import`. See [MCP servers](mcp.md).

### Integrations
Tabbed UI for saved connections. Notify destinations (Slack / webhook / file) that `notify` handlers reference by id, plus data-source and service *kinds* — CSV / Postgres / SQLite (which auto-generate find/count tools) and Gmail (OAuth). See [Integrations](integrations.md).

### General
MCP token rotation, data paths, retention, scheduler heartbeat.

## `/help`

CLI reference grouped by purpose. Each command shows a "Where in the UI" link when equivalent dashboard action exists. Links to user guides on GitHub (quickstart, agents, flows, tools, mcp, output widgets, templating, dashboard).

## `/help/tutorial`

7-step progress-tracked walkthrough. Scaffolds a hello agent, runs it, adds a second node, explores secrets, etc. Progress reflects your actual project state.

## Related

- [Quickstart](quickstart.md) — first-touch walkthrough
- [Build from a goal](build-from-goal.md) — Build + Improve-layout wizards
- [Agents reference](agents.md) — every YAML field
- [Output widgets](output-widgets.md) — widget types + AI templates
- [MCP servers](mcp.md) — import + lifecycle
