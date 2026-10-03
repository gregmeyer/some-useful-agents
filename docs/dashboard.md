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

The top bar: `sua · Agents · Pulse · Settings · Help`. The `sua` brand is Home, which is your inbox (`/`). **Agents** groups the building blocks; its pages share an in-page tab strip (**Start here · Agents · Behaviors · Tools · Runs · Packs · Scheduled**) under the page header. An amber **"N need your reply →"** toast in the top bar (every page) appears when inbox threads are waiting for you. The **Ask sua** bar under the top bar starts a conversation with the triage agent from anywhere.

### The conversation panel

Asking sua opens the answer in a panel beside the page, not over it, so you can keep looking at the tile or run you're asking about. **Ask sua** in the top bar, or **Cmd/Ctrl+K**, opens the panel (your last thread, or a box to start a new one) and closes it again. The panel stays open as you move between pages, per browser tab.

- With no thread open, the panel is your inbox: a box to ask sua, then **Needs you · Open · Conversations · Done** (with counts), a search and your threads, 25 at a time. It opens on Needs you when something is waiting. Pick a thread to read and reply in the panel; **← Inbox** goes back to the list where you left it. The list updates as threads change.
- **↗** opens the thread in the inbox; **⤢** widens the panel and **⤡** puts it back; **–** minimizes it to a pill in the corner, which lights up when a reply lands.
- On wide screens the page makes room for the panel; on narrower ones it slides over the page; on a phone it fills the screen. **Esc** closes it while you're in it.

On Home the same inbox fills the page instead (below), so it's one inbox at two widths.

## `/` — Home (your inbox)

Home is your inbox on one canvas: the list on the left (ask box, **Needs you · Open · Conversations · Done**, search), the open thread on the right with its conversation, action cards and inline widgets. Replies stream in over the chat WebSocket. `/inbox` is the same page, and `/inbox/:id` opens it with that thread selected; picking a thread updates the address. On a narrow screen you see the list or the thread, with **← Inbox** to go back. The **Autonomy** control (Full / Approve first / Off) sits above it. It's the same inbox the conversation panel shows beside other pages.

With no agents installed, Home is the Build-from-goal empty state instead. The board of agent tiles lives on [Pulse](#pulse--the-board), and run activity on [`/runs`](#runs--runs-list).

On Home the list also has **Filter and sort** (where a thread came from, its agent, a tag, starred only; sort by latest activity, oldest first or priority; every tab's count follows the filters), a ★ on each thread, and checkboxes: select threads, or all on the page, then **Resolve** or **Dismiss** them together. Starred threads lead whatever sort you pick.

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

Six tabs:

### Overview
- **DAG visualization** — Cytoscape canvas with wheel-zoom + drag-pan. A floating toolbar in the bottom-right has **+** (zoom in), **⧇** (fit to view), and **−** (zoom out) buttons; clicks bind to `cy.zoom()` / `cy.fit()`. The canvas height adapts to graph size — 380px default, 240px compact for 1–2-node DAGs — so a small graph doesn't drown in an empty grid and a dense one stays readable without leaving the page. Click any node for the action dialog (Edit, Replay-from-here, Jump to details).
- **Edit wiring** — toggles the canvas into a wiring editor. Drag one node onto another to make the second depend on the first, or click a source node then a target if you'd rather not drag. Click an edge to remove it. **Save wiring** writes every change as a *single* new version, so restructuring five nodes is one entry in history rather than five. Cycles are refused (with the path that closes the loop), and so is cutting an edge whose downstream still reads `{{upstream.x.result}}` or `$UPSTREAM_X_RESULT` — those would crash the node. Cutting one that an `onlyIf` predicate still names saves with a warning, because it does not crash, it just quietly changes which branch runs. Run detail's DAG is never editable: it's a record of what happened.
- **Agent calls** — what this agent invokes and what invokes it, each linked, with the node that does the calling. A target chosen at run time (e.g. `{{inputs.LOGGER_AGENT_ID}}`) is shown as "chosen at run time" rather than a dead link; one naming an agent that no longer exists is badged `missing`. The section is omitted entirely for agents that neither call nor are called.
- Latest run's output widget (if declared)
- Stats strip: total runs, success rate, avg duration
- Signal + output widget previews

### Chat
Talk to the agent. Each message is a run (linked under the reply), and the agent sees the conversation so far. Replies stream in as they're written (with Claude), with the tools the agent calls shown as it calls them; an agent with an A2UI `view:` replies with its widget, and clicking a button in it sends the next message. Conversations are listed on the left; open one to continue it, or delete it (its runs are kept). An agent without a text input for the message says so and points at the YAML tab. See [conversations.md](conversations.md).

### Nodes
Edit / delete / add nodes inline. Template palette autocomplete for upstream fields + inputs + vars. Per-node timeout, env, secrets, onlyIf predicates. **Goal nodes** are added and edited here too (goal, tools, budget); llm and goal nodes pick the tools their model may call from a searchable checklist that shows policy blocks. See [goal-agents.md](goal-agents.md#editing-in-the-dashboard).

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

**Tabs:** Imported / Built-in / Servers / Integrations (with counts). Tools is the one home for everything an agent can call.

- **Imported** — tools imported from MCP servers or authored locally.
- **Built-in** — the tools that ship with the runtime (plus tools generated by integrations).
- **Servers** — imported MCP servers with tool counts, **Enable/Disable** (gates every tool from that server) and **Delete** (cascades). See [MCP servers](mcp.md).
- **Integrations** — saved connections: notify destinations (Slack / webhook / file) and data-source / service kinds — CSV / Postgres / SQLite (which generate find/count tools) and Gmail (OAuth). See [Integrations](integrations.md).

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

Per-node execution table with stdout, exit codes, errors, timings. For `llm-prompt` nodes, real-time turn progress via stream-json, and a **tool calls** list: every tool the model called during the node, whichever provider it ran on (`native` marks a provider's own tool, e.g. claude's WebFetch), each expandable to its arguments and result. Runs from before this was recorded fall back to the tool events in the progress stream. "Replay from node" button on each row. The **Node execution** header (title + search input + status-filter dropdown) sticks at `top: 0` while node cards scroll under it; an rAF-throttled scroll observer releases the DAG/Result sticky bar above it back to `position: static` when this header reaches the release line, so the two sticky surfaces don't fight for the top of the viewport.

**Waiting.** A run stopped at an `ask` node shows *waiting* and a banner with the question, an **Answer** button (to its inbox item) and **Cancel run**. See [ask-a-person.md](ask-a-person.md).

**Budgets.** Goal and llm nodes show turns, tool calls and time used against their budget; an out-of-budget node says which limit it hit and links to the fix. **Sub-runs** (agents a run called) are indented as a tree.

**Cost.** The run's cost (USD at list price, including agents it called) and tokens appear in the header, and each llm node carries a cost chip whose hover lists every provider attempt. See [cost.md](cost.md).

Resolved variables panel shows what values the run actually saw (inputs after defaults, vars after substitution).

**Cancel + abandoned errors.** A **Cancel** button appears while the run is `running` or `pending`. The cancel route SIGTERMs the spawned child and escalates to SIGKILL after 5s if the child hasn't exited, then finalizes both the run row and any still-`running` `node_executions` rows to `cancelled` with a flash banner. A separate `errorCategory: 'abandoned'` appears on rows the orphan reaper finalized on a later dashboard boot (i.e. a daemon restart killed the parent process mid-run); the run-level error names the cause inline. See [Security model § Orphan process reaper](SECURITY.md) for the mechanism.

## `/pulse` — the board

Pulse is a [board](boards.md), drawn as one A2UI canvas: arrange it with **✎ Arrange** (sections, grids, tabs, rows, cards) or **✨ Suggest a layout**, or build a new board from a description with **＋ New board**; agents you haven't placed are under **Everything else**, grouped as described next. (Settings → Appearance switches back to the previous layout for one release.)

The board is your agents at a glance. Each agent with a `signal:` block, or an A2UI `view:`, gets a tile showing its latest result, and every tile has a **Run** button. Tiles are drawn with [A2UI](a2ui-views.md) (sorting, filtering, tabs and run-in-place forms work in the browser); Settings → Appearance switches back to the previous renderer for one more release.

**13 templates:** `metric`, `time-series`, `text-headline`, `text-image`, `image`, `table`, `status`, `media`, `widget`, `comparison`, `key-value`, `story`, `funnel`.

**`template: widget`** is special — mirrors the agent's own outputWidget. No mapping required.

**Everything else groups tiles by how recently you used them** — Health (system metrics),
Recent (ran in the last 7 days, newest first), Idle, and Never run. Empty groups
are omitted. The ordering is meant for a run console: what you used last is what
you are most likely to run again, and agents you set up but never used are
collected at the bottom rather than scattered through the board.

Configure tiles via the ⚙ gear on each one, and set a tile's palette in **✎ Arrange**. Hide/unhide via the × (it toggles the agent's `pulseVisible` flag). System tiles (runs today, avg duration, failure rate, agent count, **scheduler**) head the tray until you place them.

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

**✨ Suggest a layout** — on Pulse and any named dashboard. The layout planner proposes an arrangement that opens in the editor for you to adjust and save. (With boards switched off, the previous **Improve layout** wizard is still there, including drafting new agents inline; see [Build from a goal § Improve layout](build-from-goal.md#improve-layout-path-a--path-b).)

**Dashboards dropdown** — in the board header; switches between the default board and any named dashboard, with a "New dashboard name" field to create one inline. Long names truncate with a tooltip. **+ Install from Packs** opens an in-place modal listing every registered-but-uninstalled pack with an Install button (you stay on the board), plus a "Browse all packs →" link to the full `/packs` page.

## `/dashboards/:id` — Named dashboards

Named views over installed agents — pack-owned (e.g. `starter:media`) or user-created — each a [board](boards.md): arrange it with **✎ Arrange** (which also adds agent tiles) and **✨ Suggest a layout**. Render at `/dashboards/:id`, edit inline at `/dashboards/:id/edit` (rename the dashboard, add / remove / reorder sections and tiles, all server-rendered). Renaming changes only the display name — the dashboard's stable id is preserved (shown in the editor header), so delete and pack uninstall still match after a rename. The built-in "Default Dashboard" (Pulse) has no stored row and can't be renamed. The **+ Add tile** modal is in-place and offers a blank agent or build-from-goal; edit mode persists across reloads and warns before you navigate away. Pack-owned dashboards are editable but not deletable (uninstall the pack) — their editor explains why and links to the owning pack's page, where Uninstall removes the pack's dashboards while keeping any contributed agents; user-created ones are deletable, and removing the last tile offers to delete the dashboard. Each named dashboard curates its own tile list independently of `pulseVisible`. The same tile behaviors as Pulse apply (first-run auto-execution, in-place Run again, CSP image-allow).

## `/boards/:id` — Boards

Redirects to the board's page (`/pulse` or `/dashboards/<id>`). With boards switched off in Settings → Appearance, `/boards/<id>/canvas` shows the board's canvas. `/boards/<id>.json` returns the board's layout. See [Boards](boards.md).

## `/settings`

**Appearance → Brand** sets one theme for the whole dashboard (preset, colours for dark and light mode, fonts, corner radius, tile accents). See [Brand theme](brand.md).

Tabs: Secrets, Variables, Claude Desktop, LLM, Usage, Policies, Temporal, Appearance, General. (MCP servers and integrations live under [Tools](#tools--tools-list).)

### Secrets
Encrypted-at-rest store (scrypt + AES-256-GCM). Unlock with passphrase, set/delete secrets, copy-before-save modal for newly created secrets.

### Variables
Global plain-text values. CRUD with values visible. Referenced as `$NAME` / `{{vars.NAME}}`.

### Claude Desktop
sua as an MCP server for Claude Desktop and other clients: the config to paste, and token rotation. See [MCP](mcp.md).

### LLM
The provider waterfall: reorder, add OpenAI-compatible endpoints, enable/disable. See [LLM providers](llm-providers.md).

### LLM → Pricing
Prices (USD per million tokens) for providers that report tokens but not cost (codex, OpenAI-compatible endpoints), per provider or per `provider/model`. See [cost.md](cost.md).

### Usage
What runs cost over the last 1 / 7 / 30 days, by agent and by provider/model, with a note when some tokens had no price, and the default **spend limits** (per run, per agent per day) for agents without their own. See [cost.md](cost.md).

### Policies
The tool policy: the rules in order ("the last match decides"), add / edit / reorder / delete, the default action, **Edit as JSON**, **Undo last change**, and **Would this be allowed?** to test a call. An invalid file is flagged in red (it blocks every tool call) and can be fixed here. See [tool-policies.md](tool-policies.md).

### Temporal
Connection status for the durable backend. See [Temporal](temporal.md).

### Appearance
The **Brand** theme (a preset, then your colours, fonts, corner radius and tile accents, for everyone; see [Brand theme](brand.md)), the **Widget renderer** switch (widgets are drawn with A2UI; untick to use the previous renderer for one more release), and **Pulse and dashboards** (untick to use the previous layout for one more release). See [A2UI views](a2ui-views.md).

### General
Data paths, retention, scheduler heartbeat.

## `/help`

A short tour, the CLI grouped by purpose (each command links to where the same thing lives in the dashboard), and links to the user guides on GitHub.

## `/help/tutorial`

8-step progress-tracked walkthrough. Scaffolds a hello agent, runs it, adds a second node, explores secrets, etc. Progress reflects your actual project state.

## Related

- [Quickstart](quickstart.md) — first-touch walkthrough
- [Build from a goal](build-from-goal.md) — Build + Improve-layout wizards
- [Agents reference](agents.md) — every YAML field
- [Output widgets](output-widgets.md) — widget types + AI templates
- [MCP servers](mcp.md) — import + lifecycle
