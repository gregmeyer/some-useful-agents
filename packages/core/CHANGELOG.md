# @some-useful-agents/core

## 0.19.0

### Minor Changes

- 16e3a74: `sua agent install <url>` — fetch + validate + import an agent over HTTPS.

  End-to-end install flow for sharing agents. The CLI verb fetches a YAML, validates against `agentV2Schema`, and writes through the same `upsertAgent` path that `sua workflow import-yaml` uses (DB-backed). The dashboard ships a paste / preview / confirm form at `/agents/install`, mirroring the v0.18 MCP import idiom.

  - `core/registry`: GitHub `/blob/<branch>/<path>` URLs are normalized to `raw.githubusercontent.com`; `gist.github.com/<user>/<id>` is resolved via the `/raw` redirect; plain HTTPS passes through. Size cap (256 KB) and 10-second timeout. URL gated by `assertSafeUrl` before fetch — link-local and loopback hosts are blocked.
  - CLI accepts `--from-gist`, `--auth-header "Bearer ..."` for private fetches (never persisted), `--yes` for non-interactive runs (refuses overwrite without `--force`), and `--force` to upgrade an existing id. ID-collision diff prompt shows declared inputs / secrets / mcp / schedule before confirming.
  - Trust model: install never auto-runs. `source` is always set to `local` regardless of what the YAML declares — the installer takes ownership. Community-host allowlist is deferred until a trusted host actually exists.
  - Dashboard `/agents/install` — three-step paste/preview/confirm form. Same `Authorization` header support as the CLI; never persisted.
  - A `vitest.config.ts` resolve alias is added so cross-package tests resolve workspace packages to source TS without a rebuild step.

  Pairs with the source-on-upgrade fix that ensures the installer-takes-ownership invariant holds across upgrades, not just initial installs.

- 76411f7: Two key shipped agents rewritten, plus a parser fix that was silently breaking both.

  **Parser fix.** `parsedToAgent` and `NODE_KEY_ORDER` in `agent-yaml.ts` had drifted from the v0.16+ schema, silently stripping `tool`, `action`, `toolInputs`, `onlyIf`, `conditionalConfig`, `switchConfig`, `loopConfig`, `agentInvokeConfig`, and `endMessage` from every YAML round-trip. Same shape as the `outputWidget` drift fix in #167. Any agent using MCP-driven tools or control-flow nodes lost those fields on import — so `graphics-creator-mcp` arrived in the DB as a sequence of bare `claude-code` nodes with no prompts, and `agent-analyzer`'s `onlyIf` skip-on-valid optimisation never fired because the field was dropped. Two new round-trip tests lock down every node field the schema accepts so the next addition can't slip through silently.

  **graphics-creator-mcp** — single-node rewrite. The previous 6-node theme → save → render → composite pipeline carried multiple latent bugs (missing prompts, broken upstream wiring, theme step that produced nothing reusable). New version is one `claude-code` node that calls the modern-graphics MCP server's `list_themes` + `generate_graphic` tools in one round-trip, returns structured JSON, and ships with an interactive output widget so the tile becomes a self-contained ask → render → preview loop on `/pulse`.

  **agent-analyzer** — three improvements to the "Suggest improvements" agent:

  - `fix` node now skips entirely when validate's `valid` field is true (saves a Claude round-trip on the happy path; this was already declared but didn't survive parsing — now does).
  - `fix` timeout raised from 90s to 240s and `maxTurns` from 2 to 4.
  - `fix` prompt rewritten to be tighter: leads with the validation error in an explicit fence, includes common fix recipes (shell-vs-template upstream refs, uppercase input names, missing enum values, control-flow configs), and emphasises "minimal change" so Claude doesn't try to redesign the agent on every fix attempt.

  **Dashboard fix-attempt fallback** — the inline auto-fix used by the "Suggest improvements" modal had `timeout: 60s` / `maxWait: 65s` / `maxTurns: 1`, no slack for any non-trivial agent. Bumped to `timeout: 180s` / `maxWait: 200s` / `maxTurns: 3`. When the auto-fix still doesn't return in time, the new error message points users to "Edit manually" with the suggested rewrite as a starting point, rather than implying the dashboard is broken.

- 16e3a74: `sua daemon` — run schedule, dashboard, and (optional) MCP as detached background services.

  New top-level CLI verb with `start | stop | restart | status | logs` subcommands. PIDs and rotated logs live under `<dataDir>/daemon/`; existing scheduler heartbeat is reused for health detail. Detached subprocesses re-invoke the local `sua` binary with the corresponding verb so config and env propagate cleanly.

  - `sua daemon start` spawns the configured services, waits for them to settle, then reports per-service `started` / `crashed on startup` (with log path) / `already running`. Children that crash are caught by a post-spawn liveness check, not silently presented as running.
  - `sua daemon status` shows pid + scheduler heartbeat + a clickable URL column for services that bind a port. URLs render as OSC 8 hyperlinks in TTY-aware terminals; non-TTY contexts (pipes, file redirects) emit plain text. Dashboard URL embeds `/auth#token=<token>` so a click in a fresh browser completes the auth handshake without bouncing through a sign-in page.
  - New optional `daemon` config block: `services` (default `[schedule, dashboard]`), `logRotateBytes` (default 10 MB), plus separate `dashboardPort` (default 3000) and `dashboardBaseUrl` (default loopback) fields. Daemon now passes `--port` through to `dashboard start` and `mcp start` so configured ports actually take effect under supervision.
  - The scheduler now idles instead of exiting when zero agents have a `schedule:` field, so the daemon can supervise a dashboard-only project without the schedule slot flickering "stale (pid dead)".
  - Dashboard `startDashboardServer` rejects its listen promise on `'error'` events (e.g. EADDRINUSE) instead of hanging — the previous behavior left the daemon thinking the dashboard was running while it never bound.

  Closes the "schedules don't fire when the terminal closes" gap from the v0.19 operationalization plan.

- 16e3a74: Notify Slack messages now include a clickable run link.

  The notify dispatcher already supported a run-link in Slack Block Kit messages — the slack handler builds `<base/runs/<id>|Open run in dashboard>` when `dashboardBaseUrl` is on the dispatch context. Earlier release just never wired that field from any of the four sites that call `executeAgentDag`, so the link never rendered in practice.

  End-to-end plumbing in this release:

  - New optional `dashboardBaseUrl?: string` field on `SuaConfig` plus a `getDashboardBaseUrl()` helper that falls back to `http://127.0.0.1:<dashboardPort>`. Override when the dashboard is behind a reverse proxy or bound to a non-loopback host that the notify destination needs to reach.
  - `sua workflow run` and `sua workflow replay` pass the resolved base URL into executor deps.
  - `startDashboardServer` accepts an optional `dashboardBaseUrl` (CLI passes it from config; tests can override). Stored on `DashboardContext` (default `http://<host>:<port>` if not supplied). Run-now and replay routes thread `ctx.dashboardBaseUrl` into executor deps.
  - Integration test asserts the slack handler payload contains the expected dashboard link when `dashboardBaseUrl` is set on deps.

- e0b4d96: Interactive widgets — turn pulse tiles into mini-apps.

  Output widgets gain an opt-in `interactive: true` flag. When set, the pulse tile renders with an inline inputs form + Run button + state machine that polls `/runs/:id/widget-status` until the run completes — no navigating away. Each tile becomes a self-contained ask → think → answer → ask again loop with smooth CSS transitions between states.

  Five visible states (`idle | asking | running | success | error`) cross-fade at ~220 ms with a `transform: translateY` so content doesn't pop. The tile gets a subtle pulsing border while running so it reads as "active" at a glance from the pulse page. `prefers-reduced-motion` disables the animations.

  Schema additions on `outputWidget` (all optional):

  - `interactive: boolean` — opts the tile into the new mode
  - `runInputs: string[]` — subset of `agent.inputs` to expose in the form (defaults to all)
  - `askLabel: string` — overrides the initial Run button text (default "Run")
  - `replayLabel: string` — overrides the post-result button text (default "Run again")

  Two new dashboard routes:

  - `POST /agents/:name/widget-run` — accepts `input_*` form fields and returns `{ runId }` JSON. Reuses the existing DAG executor and auth.
  - `GET /runs/:id/widget-status` — lightweight `{ status, result, error }` JSON polled every 500 ms.

  Polling caps at 60 s (120 ticks) → tile transitions to a "still running, view details" state with a link to `/runs/:id`. Cancel button hooks the existing `/runs/:id/cancel` route.

  The output widget editor on agent config gains an "Interactive mode" disclosure: a checkbox to enable, checkboxes per declared input to filter what the tile shows, and label overrides for both buttons.

  Non-interactive widgets are completely unchanged. Existing widgets without the flag render in the same static mode they always have.

  Plan: `~/.claude/plans/interactive-widgets.md`.

  Out of scope (deferred):

  - Widget cross-fade replaces the result with the raw text in a `<pre>` for now; live re-render of the actual widget HTML on completion is a follow-up (the next pulse refresh swaps in the proper widget).
  - Streaming intermediate node outputs into the tile.
  - Channel/file/secret pickers tied to specific input types beyond text/number/enum/boolean.

- 4c8de94: Form-based notify editor for the dashboard.

  Replaces the JSON textarea on agent config with a structured form. Top-level checkboxes for `on` (failure/success/always), a comma-separated list for declared `secrets`, and per-handler cards with type-specific fields:

  - **slack** — `webhook_secret` dropdown (populated from the secrets list), `channel`, `mention`
  - **file** — `path`, `append` checkbox
  - **webhook** — `url`, `method` (POST/PUT), `headers_secret` dropdown (optional, also populated from the secrets list)

  Three "+ Add slack / + Add file / + Add webhook" buttons let operators compose the handler array without remembering schema field names. Removing a handler is an in-row "Remove" button. Saving serializes the form state to a single hidden `notify_json` field; the route validates the payload through the same `agentV2Schema` as the YAML import path so cross-checks (e.g. handler-referenced secrets must be declared) still fire.

  Backwards compat: the route accepts either the new `notify_json` field (preferred) or the legacy `notify` JSON blob — ad-hoc API callers and existing tests aren't broken.

  Out of scope (future): live Block Kit preview for slack handlers; channel picker via Slack OAuth (depends on PR-C); secret-name autocomplete (the cross-check at save time covers typos).

- 16e3a74: `notify:` field on agent v2 — fire user-declared handlers on run failure / success / always.

  After a DAG run commits its final state, the executor dispatches handlers in parallel and isolated. A broken Slack webhook can never turn a successful run into a failed one — handler exceptions are caught, logged via the existing logger, and never propagate back into the run.

  Three builtin handler types:

  - **slack** — POSTs a Block Kit message to a Slack incoming webhook URL stored as a secret. Headline (status emoji + agent name + status), agent id / run id / start+complete timestamps, last 200 chars of error if failed, and (when `dashboardBaseUrl` is configured) a clickable link back to the run page. Optional `mention` and `channel` fields.
  - **file** — appends a JSON line per fire to a project-cwd-scoped path. Reuses the file-write builtin's path-traversal guard.
  - **webhook** — generic `POST` with body `{ agent, run_id, status, started_at, completed_at, error?, output? }`. Optional secret-backed `Authorization` header. URL gated by the existing `assertSafeUrl` SSRF guard.

  Schema corrects the original plan's assumption that `{{secrets.X}}` templates work in handler config: secrets in this codebase are env-var-only at the node level, so notify config declares its own `secrets:` list and the dispatcher resolves values from the secrets store. A zod cross-check rejects handlers that reference an undeclared secret. `{{vars.X}}` template substitution works in string fields like `channel`, `path`, and `url` via the existing template helpers.

  Dashboard agent config gets a JSON-textarea editor for the notify block and a `POST /agents/:name/notify/update` route alongside the existing widget editor pattern. Email handler intentionally not in this release — defer until Slack proves the pattern.

- 12627d1: `sua workflow rm <id>` and dashboard delete — hard-delete agents.

  Closes the gap where `archive` was the only way to "remove" a v2 DB-backed agent. Archived agents stayed visible in `sua workflow list` and held the id namespace, making test fixtures and abandoned agents hard to clean up.

  - New CLI verb `sua workflow rm <id>` shows agent metadata (status, source, version count, run count + last fire, schedule), then a `[y/N]` confirmation prompt. `--yes` skips the prompt for scripts.
  - New dashboard "Danger zone" disclosure section on the agent overview tab. The form requires the operator to **type the agent id verbatim** before the browser will submit — the input's `pattern` attribute enforces the exact match. The route also re-validates the confirm token server-side, so a client bypassing the form still can't accidentally delete.
  - Both surfaces use the existing `AgentStore.deleteAgent`, which cascades to `agent_versions` rows but leaves runs intact (runs reference agent id as a string, no FK). Run history is preserved as append-only — clicking the agent column in /runs for a deleted agent now 404s with a "this agent has been deleted" hint, but the run row itself is still inspectable.

  Refuses to delete an agent that's invoked by another agent's `agent-invoke` node (existing core behavior — the error message names the dependent agents). No `--purge-runs` or cascade-runs flag; orphan-cleanup is a separate utility (deferred).

### Patch Changes

- 77ab55b: Fix YAML round-trip silently stripping `outputWidget` fields.

  `agent-v2-schema.ts` carried its own inline `outputWidget` zod definition that had drifted from the canonical `outputWidgetSchema` in `output-widget-schema.ts`. Anything that round-tripped agents through YAML (`workflow import-yaml`, `agent install`, `workflow export` → re-import) lost the missing fields silently because zod accepted the document but the inline definition didn't list those keys.

  Drift accumulated over time:

  - `ai-template` widget type
  - `preview` field type
  - `prompt` and `template` fields (ai-template generator output)
  - `interactive`, `runInputs`, `askLabel`, `replayLabel` (PR #166)

  Fix: the inline schema is replaced with `outputWidgetSchema.optional()` so there's a single source of truth.

  Surfaced when adding `interactive: true` to the Magic 8-Ball agent via `workflow export → patch → workflow import-yaml` and observing the field disappear on re-export. Also fixes the latent bug where ai-template widgets authored via the dashboard couldn't survive YAML round-trip — they parsed cleanly but the prompt/template fields were stripped.

  No agent data migration needed; existing DB-stored widgets keep their fields and now correctly survive a YAML round-trip.

- 16e3a74: Fix `sua agent install` not propagating `source: local` when upgrading an existing agent.

  The install path explicitly built its upsert payload with `source: 'local'` to honor its installer-takes-ownership contract, but both branches of `upsertAgent` (metadata-only update when DAG unchanged, new-version creation when DAG differs) called `updateAgentMeta` with a patch that omitted `source`, and `updateAgentMeta`'s type signature didn't accept it either. So an existing row with `source: 'examples'` would stay `examples` even after `sua agent install --force`, quietly violating the documented contract.

  `updateAgentMeta` now accepts `source` and writes it. Both `upsertAgent` paths pass `agent.source` through. New test in `AgentStore.upsertAgent` covers source change across both upsert paths (identical DAG → metadata-only update; differing DAG → new version).

  Initial installs of new agents were unaffected — `createAgent` honored `agent.source` directly. Only upgrades hit the bug.

- a7d1bf0: Fix `/agents` list page silently dropping flash banners.

  Mutation routes that redirect to `/agents?flash=...` (e.g. the new hard-delete from PR #162) had their messages dropped — the GET handler never read `req.query.flash` and `AgentsListInput` had no `flash` field, so the `layout()` call rendered without a banner. Users would delete an agent and see nothing change visually beyond the agent disappearing.

  Wires the `flash` end-to-end: route reads `req.query.flash` (kind=ok) and `req.query.error` (kind=error), `AgentsListInput` accepts the optional banner, and the layout renders it via the existing `flash--ok` / `flash--error` styles already used by `/runs`. Test added.

  Same pattern as `/runs` and the agent detail page already use; agents-list was the odd one out.

- 16e3a74: Add `.claude/` to `.gitignore` so subagent worktree directories from Claude Code sessions can't accidentally land in commits as embedded git repositories.

  No runtime impact; repo-hygiene only.

- 3d42b6b: Fix interactive widgets rendering raw JSON in a `<pre>` on completion.

  PR #166's interactive widgets shipped with a known follow-up: when a run completed in the tile, the result body got pretty-printed JSON instead of the actual widget. The proper widget render only appeared on the next pulse refresh, which broke the in-place feel — the whole point of interactive mode.

  Fix: `GET /runs/:id/widget-status` now server-renders the agent's `outputWidget` against the run result and includes a `widgetHtml` string in the response when the run is `completed` and the agent has a widget. The tile JS swaps that HTML into the result box on success, with the same fade-in transition as before. Falls back to the prior `<pre>` behavior when no widget is configured (e.g. agent without an outputWidget) or the widget renderer rejects the result.

  Same renderer that powers the static pulse tile now runs on the widget-status endpoint, so the rendering is identical between first-load and post-run states. No client-side widget logic to keep in sync.

- be8ef64: Fix interactive widgets resizing during state transitions.

  PR #166's interactive widgets used `display: none` to hide inactive panes (asking / running / success / error / stuck), which removed them from the layout entirely. That meant the tile's height jumped between states — the form pane is one height, the spinner-only running pane is much shorter, the result is variable, the error card is somewhere in between. Asking → running → success felt jarring as the container resized twice.

  Fix: switch to a CSS Grid stack. All panes share the same grid cell (`grid-template-areas: 'stack'`), so the cell's height is `max(child heights)` and stays stable across transitions. Inactive panes get `opacity: 0; visibility: hidden; pointer-events: none` instead of `display: none`, so they keep contributing to the cell sizing without affecting interaction. CTA rows also pin to the bottom via `margin-top: auto` so the Run button sits in the same place regardless of pane content.

  Short panes (running, stuck, error) center vertically inside the cell so they don't anchor awkwardly to the top of an oversized container. The container also gets a `min-height: 8rem` baseline so the very first pre-run render doesn't open at zero height.

- 16e3a74: Fix `/runs` page-size links rendering raw `<a>` HTML as escaped text.

  The page-size selector in the runs list footer was building anchor tags as plain strings concatenated with `.join(' ')`, then interpolating into a `html\`...\``template tag — which escapes string values. The result was visible literal`<a href="...">25</a>` text instead of clickable links.

  Switched to the same SafeHtml-fragment pattern the agents-list and tools-list pagers already use, so each link is a `html\`...\`` template literal that the renderer treats as trusted markup.

- 77687c5: Three small polish fixes surfaced during v0.19 testing rounds:

  **SSRF error copy is no longer caller-specific.** `assertSafeUrl` originally said `"http-get and http-post only allow requests to public addresses"` — accurate when it shipped, but `agent install` and the notify dispatcher now call it too. Generalized to `"SSRF protection: only public addresses are allowed."` so the message reads correctly from every caller.

  **`secrets rm` and `secrets remove` work as aliases for `secrets delete`.** Both are common muscle-memory choices (`rm` from shell, `remove` from npm). The canonical command stays `delete`; the aliases are commander-level so help text shows `delete|rm <name>` and either token resolves.

  **Deflaked the post-spawn settle test.** `waitForServiceSettle reports stale when the child dies during the settle window` was relying on a 20ms-vs-100ms timing window that lost on slow CI machines (occasional one-fail-out-of-many runs). Replaced the timer-based race with a deterministic `child.once('exit', ...)` await before the settle — verified 5× without a flake.

## 0.18.0

### Minor Changes

- 9b2956c: AI-generated output widget templates.

  New `ai-template` widget type: describe the layout in plain English, Claude generates an HTML template, we sanitize and reuse it for every run. Fields can be referenced via `{{outputs.NAME}}` and the raw output via `{{result}}`; values are HTML-escaped before substitution and the rendered result is run back through the sanitizer at render time (defense-in-depth).

  **Abstracted LLM provider** so Codex/Gemini/etc. can plug in via `registerTemplateGenerator()` without route changes. Ships with Claude (`claudeTemplateGenerator`) by default, spawning the local `claude --print` binary with a strict system prompt.

  **Pure tag/attribute allowlist sanitizer** (`sanitizeHtml`, zero deps). Strips `<script>`, `<iframe>`, `<form>`, `on*` handlers, `javascript:`/`vbscript:` URLs, and non-image `data:` URLs. Preserves SVG with its cased attributes (`viewBox`, `gradientUnits`, etc.) so generators can emit inline charts.

  **UX:** Generate click opens a modal with a spinner, elapsed-seconds counter, and a Cancel button wired through `AbortController` + `req.close` so Claude is actually killed on cancel.

  New exports from core: `sanitizeHtml`, `substitutePlaceholders`, `claudeTemplateGenerator`, `getTemplateGenerator`, `listTemplateGenerators`, `registerTemplateGenerator`.

- 9b2956c: New builtin tool + example agents for data visualization.

  - **`csv-to-chart-json`** builtin — turns CSV (inline or file path) into the JSON shape `modern-graphics-generate-graphic` expects. Three shapes: `simple` (labels + values), `series` (labels + named series), `cohort` (date + size + values). CSV parser handles quoted fields and escaped quotes.
  - **`graphics-creator-mcp`** example agent — topic + audience brief → modern-graphics theme creation → hero render → composite overlay. Demonstrates MCP tool chaining end-to-end.
  - **`chart-creator-mcp`** example agent — CSV input → `csv-to-chart-json` → `modern-graphics-generate-graphic`. Supports all 22 chart layouts via enum dropdown.

- 9b2956c: MCP servers as a first-class entity.

  Tools imported from an MCP server are now grouped under a named server record. The new `mcp_servers` SQLite table plus an additive `mcp_server_id` column on `tools` lets the dashboard manage whole servers at once — enable/disable gates every tool from that server without deleting anything, delete cascades to all its imported tools.

  - New `type: 'mcp'` tool implementation with pooled MCP client (stdio + streamable-HTTP)
  - `/tools/mcp/import` accepts a Claude-Desktop/Cursor `mcpServers` config, a bare map, or a single `{command,args,env}` entry. JSON and YAML. Multi-server paste discovers every entry in parallel and groups the picker by server.
  - `/tools/mcp/import` also has a "Quick add by URL" shortcut for HTTP servers.
  - `/settings/mcp-servers` — table with tool counts, enable/disable toggle, cascade delete.
  - Executor gate: nodes referencing a tool from a disabled server fail with `errorCategory: 'setup'` and a clear "server X is disabled" error.
  - Tool detail page shows the source server with a link back to settings.

  Parser exported from core: `parseMcpServersBlob`, with per-entry errors so a partially-valid blob still yields the servers that _are_ valid.

- 9b2956c: Output Widget editor made self-teaching.

  Replaced the bare widget-type dropdown with a card picker. Each card has a description, ASCII layout sketch, and context-aware helper copy that updates as you switch. Field-type dropdown gains per-type tooltips and dims types that don't apply to the selected widget.

  New **"Load example"** dropdown with 5 starter widgets (Report card, Metric dashboard, File preview, Diff applier, Key-value summary) that populate the form in one click.

  New **live preview card** below the form that rerenders the widget with synthetic sample data on every edit. Backed by a new `POST /agents/:id/output-widget/preview` route — no DB writes — that reuses the existing `renderOutputWidget()` renderer.

  Matching polish on the Pulse "Output Widget" tile explainer so both surfaces use the same vocabulary.

### Patch Changes

- 9b2956c: Dashboard polish bundle.

  - **/tools** now has **User** / **Built-in** tabs with per-tab counts and pagination — replaces the combined grid where builtins filled the first page.
  - **/agents** gets the same treatment: **User** / **Examples** tabs (and a conditional **Community** tab when relevant). Source filter dropdown folded into tabs.
  - **Variables editor** supports `enum` inputs end-to-end: new values column that accepts comma-separated or JSON-array form; enum without values surfaces a clear error instead of silently saving.
  - **Pagination size links** (`12 24 48 100`) rendered correctly on `/tools` — previously HTML-escaped by the tagged template.
  - **Pulse "Output Widget" tile** explainer is now informative: describes the four widget types, how fields map to output, and links to `/agents/<id>/config`.

## 0.17.0

### Minor Changes

- 998e881: Security: SSRF protection on http-get/http-post, auth token moved from URL query param to fragment, CSP + security headers on dashboard, Postgres bound to localhost in Docker Compose.

## 0.16.1

### Patch Changes

- **docs: update READMEs for v0.16 features.**

  All package READMEs updated to reflect Pulse, build-from-goal, tabbed agent detail, filtering/pagination, LLM defaults, and security improvements.

## 0.16.0

### Minor Changes

- **feat: goal-driven agent builder + self-correcting analyzer.**

  Build-from-goal wizard: describe what you want in plain language, the builder designs a complete DAG. Self-correcting: validates YAML and fixes errors automatically. Agent analyzer reviews existing agents and suggests improvements with "Apply now" one-click save. Dynamic tool catalog injected into builder prompt. Focus prompt and last-run output context for analyzer. Auto-fix shell template mistakes.

- 544fb33: **feat: Pulse signal type + 7 curated example agents (docs sweep PR 1).**

  Adds the `AgentSignal` type (title, icon, format, field, refresh, size) to the Agent interface and Zod schema. Each agent can optionally declare a `signal:` block that defines how its output renders on the `/pulse` dashboard (the agent info radiator — page itself ships later in the dashboard revamp).

  Ships 7 curated v2 example agents that tell a tutorial narrative ("Build a daily briefing system"), replacing the 3 minimal v1 examples:

  1. **hello** — first agent, proves install works
  2. **two-step-digest** — 2-node DAG, teaches dependsOn + upstream passing
  3. **daily-greeting** — cron scheduling
  4. **parameterised-greet** — inputs with defaults (shell + claude-code companion)
  5. **conditional-router** — flow control: conditional + onlyIf + branch merge
  6. **research-digest** — agent-invoke + loop (nested flows)
  7. **daily-joke** — real HTTP via http-get tool (icanhazdadjoke.com, the only example with network)

  Each example has a `signal:` block, a header comment explaining what it teaches, and a run command. All offline examples use mock data from `agents/examples/data/`.

- **feat: DAG executor refactor — LlmSpawner, progress tracking, provider field.**

  Split the monolithic executor into focused modules. LlmSpawner interface abstracts claude/codex CLI providers. progressJson column on node_executions enables real-time turn tracking in the dashboard. Provider field on nodes allows per-node claude/codex selection.

- 2ca929d: **feat: flow control foundation — node types, onlyIf conditional edges, nested run support (Flow PR A).**

  Lays the type + schema + executor foundation for control-flow primitives in agent flows. No new node type dispatch yet (conditional, switch, loop, etc. come in PRs B–E); this PR establishes the data layer and ships the `onlyIf` conditional edge feature end-to-end.

  ### What ships

  - **Extended `NodeType` union**: `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break` join `shell` + `claude-code`. Control-flow types are first-class — the executor will dispatch to dedicated logic per type.
  - **`onlyIf` on `AgentNode`**: edge-level conditional execution. Evaluates a predicate (`equals`, `notEquals`, `exists`) against an upstream node's structured output field before spawning. Skipped nodes get `condition_not_met` (not `upstream_failed`), which cascades to downstream nodes without triggering fail-fast.
  - **Control-flow config interfaces**: `ConditionalConfig`, `SwitchConfig`, `LoopConfig`, `AgentInvokeConfig`, `endMessage` on AgentNode. Ready for PRs B–E to implement.
  - **`condition_not_met` + `flow_ended`** error categories.
  - **`parent_run_id` + `parent_node_id`** on runs table (idempotent migration). Ready for nested agent-invoke runs in PR C.
  - **Zod schema** updated: accepts all new node types + `onlyIf` field. Control-flow nodes skip the command/prompt requirement.
  - **If/else branching** works today: two downstream nodes with complementary `onlyIf` predicates — one runs, the other skips.

  ### Tests

  527 total (521 → 527; +6 new):

  - onlyIf.equals skips when no match / runs when match
  - Cascading condition_not_met to downstream nodes
  - onlyIf.notEquals
  - onlyIf.exists (null = absent)
  - If/else branching pattern (complementary predicates)
  - All 521 existing tests pass unchanged (full backcompat)

- b94f89b: **feat: conditional + switch node dispatch in executor (Flow PR B).**

  First-class `conditional` and `switch` nodes now execute in the DAG. Both run in-process (no child process, no env resolution) and produce structured outputs that downstream nodes consume via `onlyIf` predicates.

  - **`conditional`**: evaluates a predicate (`equals`, `notEquals`, `exists`) against the first upstream's output field. Outputs `{ matched: boolean, value: unknown }`. Downstream nodes gate on `onlyIf: { upstream: check, field: matched, equals: true }`.
  - **`switch`**: matches an upstream field against named cases. Outputs `{ case: string, value: unknown }`. Unmatched values default to `"default"`. Downstream nodes gate on `onlyIf: { upstream: route, field: case, equals: "pro" }`.
  - Both compose with the `onlyIf` conditional edges from PR A for full if/else and multi-branch routing patterns.

- 4b97cc8: **feat: agent-invoke node type + nested runs (Flow PR C).**

  An `agent-invoke` node runs another agent as a nested sub-flow. The sub-agent gets its own `runs` row linked to the parent via `parent_run_id` + `parent_node_id`. The parent node waits for the sub-run to complete and captures its result as structured output.

  - **Recursive `executeAgentDag`** — the executor calls itself with the sub-agent's definition, threading `parentRunId`/`parentNodeId` so the audit trail is complete.
  - **`AgentStore` on `DagExecutorDeps`** — required for resolving sub-agents by id. Fails cleanly when absent or when the sub-agent isn't found.
  - **Input mapping** — `agentInvokeConfig.inputMapping` maps upstream outputs to sub-agent inputs. Supports `upstream.<id>.<field>` path expressions.
  - **Parent node result** = sub-run's final result. Sub-run failure propagates as parent node failure with `setup` category.

- 8b95d36: **feat: loop node type — iterate + invoke sub-agent per item (Flow PR D).**

  A `loop` node iterates over an array from upstream structured output, invoking a sub-agent per item. Each iteration is a nested run linked to the parent. Results are collected into `{ items: result[], count: number }`.

  - **Best-effort**: failed iterations record `null` in the items array; the loop itself only fails on invalid config or missing sub-agent.
  - **`maxIterations`**: caps the iteration count to prevent runaway loops.
  - **`ITEM` + `ITEM_INDEX` inputs**: each sub-agent invocation receives the current item as `$ITEM` and its zero-based index as `$ITEM_INDEX`.

- 48c57f8: **feat: end + break node types — early flow termination (Flow PR E).**

  - **`end` node**: terminates the entire flow cleanly when reached. Status = `completed` (not failed). All remaining nodes are skipped with `flow_ended` category. The node's `endMessage` surfaces in the run detail.
  - **`break` node**: exits the current flow (loop body / sub-flow) only. Within a top-level flow it behaves like `end`; within a loop iteration it stops that iteration and the loop continues to the next item.
  - Both compose with `onlyIf` — an end/break node gated by a conditional only fires when the condition is met. When skipped by `condition_not_met`, the flow continues normally.

- 1744a9f: **feat: branch (merge) node + dashboard viz shapes (Flow PR F — closes flow control).**

  Final flow-control PR. Adds the `branch` merge-point node and distinct Cytoscape shapes for all control-flow node types.

  - **`branch` node**: explicit fan-in merge point. Collects all upstream outputs into `{ merged: Record<string, unknown>, count: number }`. Condition-skipped upstreams are excluded gracefully (the branch always runs, even if some paths were skipped). Bypasses the condition_not_met cascade that would otherwise skip downstream nodes with a skipped dependency.
  - **Dashboard viz shapes**: conditional/switch = diamond, loop = round-octagon, agent-invoke = barrel, branch = round-pentagon, end/break = octagon. Each control-flow type also has a distinct color tint so the DAG at a glance shows where routing happens vs where execution happens.

  ### Flow control is complete

  With PRs A–F, agent flows now support:

  - `conditional` — if/else predicate evaluation
  - `switch` — multi-case routing
  - `loop` — iterate over arrays with sub-agent invocation
  - `agent-invoke` — nested sub-flows with parent-child run linking
  - `branch` — explicit fan-in merge
  - `end` — clean early termination
  - `break` — exit current loop iteration
  - `onlyIf` — edge-level conditional execution on any node

- **feat: Pulse information radiator dashboard.**

  New /pulse page: customizable information radiator with signal tiles showing agent output as live widgets. 9 display templates (metric, text-headline, table, status, time-series, image, text-image, media, + backward compat). Container layout system with drag-and-drop reorder. Edit mode toggle. Widget palette (6 color options). Auto-theming by template type. Conditional thresholds. System metric tiles replace hardcoded health strip. Markdown rendering in text tiles. YouTube click-to-play media player. Tile collapse/expand. All agents wired with signal blocks.

- 3fe5c47: **feat: tool abstraction foundation — types, schema, store, 9 built-in tools (PR 1 of 6 for v0.16).**

  Introduces the **tool** as a named, reusable unit of work a node invokes by reference. Nodes gain `tool` + `toolInputs` fields; the executor will resolve tool refs and dispatch via the built-in registry or user-defined tools (wired in PR 2). This PR lays the data layer only — no runtime dispatch yet.

  ### What ships

  - **`tool-types.ts`** — `ToolDefinition`, `ToolOutput`, `BuiltinToolEntry`, `BuiltinToolContext`, `ToolSource`, `ToolFieldType`, `ToolInputField`, `ToolOutputField`, `ToolImplementation`.
  - **`tool-schema.ts`** — Zod validation for tool YAML (id, name, source, inputs/outputs with typed fields, implementation with type-specific requirements).
  - **`tool-store.ts`** — SQLite `tools` table with CRUD (create, get, list, update, upsert, delete). Mirrors agent-store's `DatabaseSync` + `ensureSchema()` pattern.
  - **`builtin-tools.ts`** — registry of 9 built-in tools: `shell-exec`, `claude-code`, `http-get`, `http-post`, `file-read`, `file-write`, `json-parse`, `json-path`, `template`. Each has a `ToolDefinition` (schema) + a Node-native `execute()` function.
  - **`AgentNode.tool`** + **`AgentNode.toolInputs`** — optional fields on the v2 node type. When `tool` is set, the node schema doesn't require inline `command`/`prompt` (the tool provides them). `type` stays required for backwards compat — the YAML parser derives it from the tool's implementation at load time.
  - **`NodeExecutionRecord.outputsJson`** — new column on `node_executions` for structured tool outputs. Idempotent `ALTER TABLE ADD COLUMN` migration on first open.
  - **`NodeStructuredOutput`** type + `NodeOutput.outputs` field for in-memory structured output passing between nodes.
  - **Variable defaults confirmed** — `AgentInputSpec.default` + `description` already exist in types, Zod schema, and executor resolve. The UI surface (agent detail sidebar) is the remaining task.

  ### Tests

  508 total (484 → 508; +24 new):

  - `tool-schema.test.ts` — 7 tests: valid shell/claude-code/builtin tools, invalid id, missing required fields, typed inputs/outputs round-trip.
  - `tool-store.test.ts` — 7 tests: create, get, list (sorted), update, upsert, delete, nonexistent lookups.
  - `builtin-tools.test.ts` — 10 tests: registry lists all 9 tools, retrieval by id, isBuiltinTool checks, shell-exec executes a command, json-parse/json-path/template/file-read exercise the execute functions.

- 2cb27af: **feat: executor tool dispatch + output framing (PR 2 of 6 for v0.16).**

  Wires the tool abstraction from PR 1 into the DAG executor so nodes with `tool:` actually run. Adds an output framing protocol for extracting structured JSON from shell tool stdout.

  ### What ships

  - **Executor tool dispatch** — when a node has `tool:` set, the executor resolves it from the built-in registry (or the `ToolStore` for user-defined tools) and calls the tool's `execute()` function directly. Built-in tools run in-process; user tools with shell/claude-code implementations go through the existing `spawnProcess` path with a synthetic node shape derived from the tool's definition.
  - **Output framing** (`output-framing.ts`) — extracts the last JSON-parseable line from stdout as structured output. Shell tools that `printf '{"status":200}'` on their last line get automatic structured output capture. Plain-text stdout (v0.15 style) falls back to `{ result: stdout }`.
  - **`outputsJson` stored** — every completed node now writes its structured output to `node_executions.outputsJson` (the column PR 1 added). Both tool-dispatched and legacy-spawned nodes populate it.
  - **`ToolStore` on `DagExecutorDeps`** — optional; when present, the executor resolves user-defined tools from it. When absent, only built-in tools are available.
  - **v0.15 nodes unchanged** — nodes without `tool:` go through the existing spawn path. No backcompat desugaring at exec time; opt-in only.

  ### Design notes

  - Built-in tool `exit_code` is extracted from the `ToolOutput` object (tools return it as a field). Legacy spawns use the process exit code as before.
  - The executor tries framed-output extraction even on legacy nodes — if a v0.15 shell script happens to emit a JSON last line, it'll be captured. No harm if it doesn't.
  - Template resolver v2 (path-based `{{upstream.X.body.items[0]}}`) is deferred to PR 3 — this PR gets tools running; the next PR makes their outputs addressable.

  ### Tests

  517 total (508 → 517; +9 new):

  - `output-framing.test.ts` — 9 tests: JSON object/array extraction, trailing empty lines, non-JSON fallback, empty stdout, single-line JSON, `buildToolOutput` framed vs plain.
  - All 508 existing tests pass unchanged.

- 21cc114: **feat: tool picker on node forms + tool config/actions types (PR 4 of 6 for v0.16).**

  Replaces the Shell/Claude Code type radio on add-node and edit-node forms with a tool dropdown listing all 9 built-in tools + user tools. Selecting a tool dynamically renders its declared input fields with palette autocomplete (both `$` and `{{` triggers). Extends the tool model with `config` (project-level defaults) and `actions` (multi-action tools).

- 6c25718: **feat: global variables store + `sua vars` CLI (Variables PR 1 of 6).**

  Adds a plain-text global variables store at `.sua/variables.json` for non-sensitive project-wide values (API_BASE_URL, REGION, DEFAULT_TIMEOUT). Variables are visible to every agent at run time — executor wiring comes in PR 2.

  - **`VariablesStore`** in core — JSON-backed CRUD with `get/set/delete/list/getAll`. Creates the `.sua/` directory on first write.
  - **`sua vars list/get/set/delete`** CLI — mirrors the secrets CLI pattern. `set` warns when a name looks sensitive (TOKEN, KEY, PASS, SECRET) and suggests using `sua secrets set` instead.
  - **`looksLikeSensitive()`** helper — flags names that probably belong in the encrypted store.

- ffa2986: **feat: executor variables wiring + {{vars.NAME}} template resolver (Variables PR 2 of 6).**

  Global variables from `.sua/variables.json` are now injected into every node at run time.

  - **Shell nodes**: `$NAME` env var, injected after secrets but before inputs (inputs win on collision).
  - **Claude-code prompts**: `{{vars.NAME}}` template substitution via `resolveVarsTemplate()`.
  - **Precedence**: `--input` override > agent input default > global variable > secret.
  - **`VariablesStore` on `DagExecutorDeps`**: optional; when absent, no variables injected.

## 0.15.0

## 0.14.0

### Minor Changes

- f7c0689: **feat: DAG executor (PR 3 of 5 for agents-as-DAGs).**

  Walks an Agent's nodes in topological order, writes one `node_executions` row per node, categorises every failure, and skips downstream nodes cleanly when an upstream fails.

  Not yet wired into `LocalProvider.submitRun` — that swap lands in PR 4 alongside the v1 YAML migration + `sua workflow` CLI verbs. In this PR the executor is callable via `executeAgentDag(agent, options, deps)` but nothing ships a v2 Agent to it yet.

  ### What ships

  - **`executeAgentDag(agent, opts, deps)`** — creates the parent `runs` row, walks nodes topologically, writes per-node records, rolls up final status. Returns the completed `Run`.
  - **`topologicalSort(nodes)`** — Kahn's algorithm with declared-order tiebreaker. Deterministic output; defensive cycle-throw even though the v2 schema already rejects cycles.
  - **`resolveUpstreamTemplate(text, snapshot)`** — substitutes `{{upstream.<nodeId>.result}}` refs and escapes `{{` inside the substituted value so the inputs resolver can't re-expand a second time (same defense as v1 chain-resolver).
  - **`SpawnNodeFn`** injection point — production uses the built-in real spawner; tests provide canned responses without touching `spawn()`.

  ### Error categorization (per the plan's table, every row tested)

  | Failure                                         | `errorCategory`   | Source                         |
  | ----------------------------------------------- | ----------------- | ------------------------------ |
  | Secrets store missing / locked / missing secret | `setup`           | pre-spawn `buildNodeEnv` throw |
  | Missing required input at runtime               | `setup`           | pre-spawn resolve              |
  | Community shell agent not allow-listed          | `setup`           | pre-spawn gate                 |
  | `spawn()` failed (ENOENT, EACCES)               | `spawn_failure`   | exit 127 or error event        |
  | Ran but exited non-zero                         | `exit_nonzero`    | exit != 0                      |
  | Exceeded node timeout                           | `timeout`         | exit 124 after SIGTERM         |
  | Upstream failed → this node never ran           | `upstream_failed` | fail-fast short-circuit        |

  Categories with any non-completed status (failed / cancelled / skipped) are always populated; completed rows have `errorCategory: undefined`.

  ### Trust-source propagation (simplified from v1)

  The v1 chain-executor wrapped community upstream output in `--- BEGIN UNTRUSTED INPUT ---` delimiters because cross-agent chains could mix trust levels. In v2 every node inside one agent shares the parent's `source` — no cross-agent output reaches a trusted node within a single DAG. What stays: the community-shell gate. A shell node inside a `source: community` agent refuses unless the whole agent is in `allowUntrustedShell`. Same error (`UntrustedCommunityShellError`), same allow-list semantics; granularity stays at the agent id.

  ### Env + secrets (per-node)

  Each node spawns with its own env built from scratch:

  1. `process.env` filtered by trust level (MINIMAL for community, LOCAL for local/examples)
  2. Node's `envAllowlist` additions
  3. Node's YAML `env:` values (with `{{inputs.X}}` + `{{upstream.X.result}}` templates resolved)
  4. Node's **own** declared secrets from `secretsStore` — not shared across nodes
  5. Agent-level inputs (caller-supplied + defaults; sensitive names blocked even if they slip past schema)
  6. `UPSTREAM_<NODEID>_RESULT` env vars for each declared upstream

  Logged inputs (`inputs_json` on `node_executions`) redact values for any key the node declared as a secret, so reading run logs doesn't leak credentials.

  ### Tests

  27 new cases in `dag-executor.test.ts`. 367 → 394 repo-wide.

  - Topological sort (ordering, diamond, cycle throw)
  - Upstream template substitution (incl. the `{{` re-expansion defense)
  - Single-node execution: success, exit_nonzero, timeout (124), spawn_failure (127)
  - Multi-node DAG: topological execution order, upstream snapshot persistence, `UPSTREAM_*_RESULT` env injection, fail-fast + skipped downstream with `upstream_failed`
  - Secrets: injection, log redaction, missing-secret → setup, no-store → setup
  - Inputs: caller values, agent defaults, missing-required → setup
  - Community shell gate: refused by default, allowed when allow-listed, claude-code bypass
  - Env allowlist by trust level: community MINIMAL, local LOCAL

  ### What's NOT in this PR

  - Replay-from-node (PR 4 — introduces new runs with copied upstream snapshots)
  - LocalProvider wiring (PR 4 — v1 agents still dispatch through `chain-executor.ts`)
  - Removal of `chain-executor.ts` (PR 4 — once nothing calls it)
  - Dashboard DAG viz (PR 5)

- 31fd09f: **feat: v1 → v2 migration + `sua workflow` CLI + replay-from-node (PR 4 of 5 for agents-as-DAGs).**

  This PR wires everything from PRs 1–3 together into user-facing functionality. Users can now import their v1 YAML chains, see the merged DAGs, run them, inspect per-node logs, and replay from a specific node — all via the new `sua workflow` command tree.

  ### Migration (`agent-migration.ts` in core)

  - `planMigration(inputs)` — pure function, no filesystem reads; takes the v1 agent set, builds transitive `dependsOn` closures, emits one DAG-agent per connected component. Idempotent.
  - `applyMigration(plan, store)` — upserts into `AgentStore` with `createdBy: 'import'`. Leaf of the component becomes the DAG's id. `{{outputs.X.result}}` rewritten to `{{upstream.X.result}}`. `.yaml.disabled` files (v0.11's paused state) map to `status: 'paused'`.
  - Defensive rejections: mixed-source components (e.g. local depending on community) refused with a clear warning; fan-out components with multiple leaves emit an advisory and pick the alpha-first leaf; missing `dependsOn` targets flagged.
  - 14 new tests covering isolated agents, linear chains, diamonds, fan-outs, mixed-source refusal, template rewrite, idempotent re-runs, version bumps on DAG changes, commit-message preservation.

  ### `sua workflow` CLI command tree

  | Verb                                                          | What it does                                              |
  | ------------------------------------------------------------- | --------------------------------------------------------- |
  | `import [dir] [--apply]`                                      | Dry-run by default; `--apply` commits migration to the DB |
  | `list [--status <s>] [--source <s>]`                          | Table of imported DAG agents                              |
  | `show <id> [--format yaml]`                                   | Text DAG view or full YAML export                         |
  | `run <id> [--input KEY=value] [--allow-untrusted-shell <id>]` | Execute synchronously via DAG executor                    |
  | `status <id> <status>`                                        | active / paused / archived / draft                        |
  | `logs <runId> [--node <id>] [--category <cat>]`               | Per-node execution table with category filter             |
  | `replay <runId> --from <nodeId>`                              | Re-run from the pivot, reusing stored upstream outputs    |
  | `export <id>`                                                 | Emit YAML to stdout (round-trips with `import-yaml`)      |
  | `import-yaml <file>`                                          | Ingest a v2 YAML file directly (bypasses v1 migration)    |

  Run id prefixes work for `logs`/`replay`. Every command shares a single `DatabaseSync` connection via `AgentStore.fromHandle` + `RunStore.fromHandle`.

  ### Replay-from-node (new executor mode)

  `executeAgentDag(agent, { replayFrom: { priorRunId, fromNodeId } })`:

  - Copies prior `node_executions` rows for every node before the pivot in topological order, preserving their `result`, `started_at`, and `completed_at`. The audit trail makes clear these are historical, not fresh.
  - Seeds the executor's outputs map with copied results, so the pivot node sees exactly the upstream snapshot the original run produced.
  - Re-executes the pivot and all downstream nodes fresh.
  - `runs.replayed_from_run_id` + `replayed_from_node_id` populated for the UI breadcrumb.
  - Refuses the replay if the pivot isn't in the agent or if any pre-pivot node in the prior run lacks a completed result — fail-fast setup-category error rather than running the pivot with empty upstream.

  4 new replay tests: copy behavior, upstream snapshot preservation at pivot, pivot-not-in-agent refusal, missing-prior-outputs refusal.

  ### Tests

  18 new (14 migration + 4 replay). 394 → 412 repo-wide.

  ### What's NOT in this PR (landing in PR 4b before PR 5)

  - `LocalProvider.submitDagRun` — today `sua workflow run` calls the DAG executor directly. MCP and scheduler still dispatch to v1 agents via `LocalProvider.submitRun`. PR 4b adds dispatch so all three triggers (CLI, MCP, cron) route through the same DAG executor.
  - Removal of `chain-executor.ts` — stays alive until the LocalProvider swap is complete.
  - `@deprecated` markers on v1 `AgentDefinition` — paired with the swap.

  Dashboard DAG visualisation is PR 5.

  ### Manual verification

  ```bash
  cd /tmp && mkdir play && cd play
  sua init
  cat > agents/local/fetch.yaml <<EOF
  name: fetch
  type: shell
  command: "echo headlines"
  source: local
  EOF
  cat > agents/local/summarize.yaml <<EOF
  name: summarize
  type: shell
  command: "echo got=\$UPSTREAM_FETCH_RESULT"
  source: local
  dependsOn: [fetch]
  EOF
  sua workflow import --apply         # merges into one DAG named 'summarize'
  sua workflow list                   # shows fetch + summarize as a 2-node DAG
  sua workflow show summarize         # DAG topology as text
  sua workflow run summarize          # runs fetch → summarize; output: got=headlines
  sua workflow logs <runId>           # per-node table with categorised errors
  sua workflow replay <runId> --from summarize   # re-runs summarize with fetch's stored output
  sua workflow export summarize       # emits YAML
  sua workflow status summarize paused
  ```

### Patch Changes

- b7c73aa: **feat: dashboard DAG visualization + per-node execution table (PR 5 of 5 for agents-as-DAGs).**

  Completes the v0.13 user story: import your v1 YAML into DAG agents, run them, watch them in the dashboard with a real graph view and per-node logs.

  ### What ships

  - **`/agents` page** splits into two tables: v2 "DAG agents" (from AgentStore) at the top, unmigrated v1 YAML agents below. An id that exists in both tables collapses to the v2 row; the v1 header only appears when there are v1-only agents to show.
  - **`/agents/:id`** (v2 variant) renders the DAG visually via Cytoscape.js (client-rendered from a server-supplied `<script type="application/json">` payload). Nodes are round-rectangles colored by type (shell green / claude-code magenta) with edges pointing downstream. `<noscript>` fallback lists nodes textually. "Run now" dispatches to the DAG executor; community-shell DAGs require confirmation.
  - **`/runs/:id`** gains a per-node execution table for DAG runs: status, error category, duration, exit code. The DAG viz renders here too, with nodes color-coded by their execution status (completed / failed / running / skipped / cancelled). Each row links to a per-node detail section with stderr and stdout. "Replayed from …" breadcrumb shown when present.
  - **Static assets** served from `/assets/cytoscape.min.js` + `/assets/graph-render.js` with long-cache headers. Cytoscape is resolved from `node_modules` at startup; no CDN, no bundler.

  ### Files

  - New: `packages/dashboard/src/routes/assets.ts`, `views/dag-view.ts`, `views/agent-detail-v2.ts`
  - Modified: `context.ts` (adds AgentStore), `index.ts` (opens AgentStore via shared path), `routes/agents.ts` (v2-first lookup), `routes/run-now.ts` (dispatches to DAG executor for v2), `routes/runs.ts` (joins node_executions for v2 runs), `views/agents-list.ts` (two-table split), `views/run-detail.ts` (DAG + per-node table when v2)

  ### Design constraints preserved

  - No CDN
  - No bundler (cytoscape vendored through npm, served from node_modules)
  - No framework (client JS = 2KB vanilla bootstrap)
  - v2 tagged-template rendering for everything HTML

  ### Tests

  8 new cases in `dashboard.test.ts`:

  - v2 agents appear under a "DAG agents" header on `/agents`
  - `/agents/:id` renders the Cytoscape JSON payload with correct nodes + edges
  - v2 preferred over v1 when same id in both
  - `/runs/:id` shows per-node table + DAG for v2 runs
  - `/runs/:id` stays minimal for v1 runs (no per-node UI)
  - Replayed-from breadcrumb renders when present
  - `/assets/cytoscape.min.js` serves (~100KB+)
  - `/assets/graph-render.js` serves with correct content-type

  412 → 420 repo-wide.

  ### Manual verification

  ```bash
  sua workflow import --apply
  sua workflow run <agent-id>
  sua dashboard start --port 3000
  # /agents → DAG agents table
  # /agents/<id> → DAG rendered + node list
  # /runs/<id> → per-node table + DAG colored by node status
  ```

  ### Deferred to v0.14

  - Drag-and-drop DAG editing (plan's v0.14 scope)
  - Node inspector (edit secrets/inputs/env in UI)
  - Version history view + diff + rollback in UI
  - `/settings/*` tree (secrets / integrations / general)
  - Version-aware DAG rendering (currently shows current_version's DAG for all runs; a follow-up can pull the exact version the run executed)
  - `LocalProvider.submitDagRun` unification (MCP + scheduler still dispatch to v1 chain-executor — dashboard now dispatches DAG directly)

## 0.13.0

### Minor Changes

- e8b3079: **feat: AgentStore + RunStore extensions (PR 2 of 5 for agents-as-DAGs).**

  DB schema + CRUD for the v0.13 agents-as-DAGs architecture. No runtime consumers yet — the executor (PR 3) and migration/CLI (PR 4) are the consumers.

  ### `AgentStore`

  CRUD over two new tables in the same SQLite file as `runs.db`:

  - `agents` — mutable per-agent metadata (name, description, status, schedule, source, mcp exposure, `current_version` pointer, `provenance_json` for v0.15+ catalog tracking, timestamps).
  - `agent_versions` — immutable DAG snapshots (nodes + agent-level inputs + author/tags). FK to `agents` with ON DELETE CASCADE.

  ```ts
  const agent = store.createAgent({ id, name, status, source, mcp, nodes, ... }, 'cli');
  // Every edit that changes the DAG = new version
  const v2 = store.createNewVersion(id, updatedDag, 'dashboard', 'added retry');
  // Metadata edits don't bump version
  store.updateAgentMeta(id, { status: 'archived' });
  // Rollback
  store.setCurrentVersion(id, 1);
  // List + filter
  store.listAgents({ status: 'active', source: 'community' });
  ```

  `upsertAgent` handles the idempotent import case: creates on first call, updates metadata if only metadata changed, creates a new version only when the DAG shape actually differs. Used by the v1 → v2 migration (PR 4) to stay idempotent across re-runs.

  ### `RunStore` extensions

  - `runs` table gets four new nullable columns via idempotent migration: `workflow_id`, `workflow_version`, `replayed_from_run_id`, `replayed_from_node_id`. Pre-v0.13 rows stay valid; migration uses `PRAGMA table_info` to skip if already applied.
  - New `node_executions` table keyed on `(runId, nodeId)` with FK cascade to `runs`. Persists per-node status, error, error category, results, resolved inputs, and the upstream output snapshot that fed the node (critical for replay-from-node).
  - New CRUD: `createNodeExecution`, `updateNodeExecution` (partial patch), `getNodeExecution`, `listNodeExecutions(runId)` (startedAt ASC — topological order), `queryNodeExecutionsByCategory(category)` (drives `sua workflow logs --category=timeout` in PR 4).
  - Partial index on `errorCategory` (where non-null) keeps category queries cheap.
  - `Run` type gains optional `workflowId`, `workflowVersion`, `replayedFromRunId`, `replayedFromNodeId` fields.

  ### Shared-handle pattern

  Both stores expose a static `fromHandle(db: DatabaseSync)` factory. Used by the CLI main process and the DAG executor so both stores share one connection to `runs.db` (avoids two handles on the same file). Stores created via `fromHandle` do not close the DB on `.close()` — ownership stays with whoever opened the handle. Path-based constructors are unchanged; existing callers (`LocalProvider`, dashboard, CLI status/logs/cancel) need zero changes.

  ### Tests

  29 new cases: 22 AgentStore + 7 RunStore extensions including the legacy-DB migration test. 338 → 367 repo-wide.

  ### What's deliberately NOT here

  - DAG executor (PR 3) — consumes `AgentStore.getAgent()` + `RunStore.createNodeExecution()`
  - v1 YAML migration (PR 4) — uses `AgentStore.upsertAgent()` with `createdBy: 'import'`
  - Dashboard DAG viz (PR 5)

- 0e21b19: **feat: Agent v2 types + YAML schema + round-trip (PR 1 of 5 for agents-as-DAGs).**

  Foundation work for the v0.13.0 "agent is a DAG of nodes" architecture. No runtime behavior change yet; nothing else in the repo consumes these types. Each subsequent PR in the series adds a layer:

  - **This PR (v2 types + YAML):** `Agent`, `AgentNode`, `AgentVersion`, `NodeExecutionRecord` types; Zod schema for YAML v2; `parseAgent()` + `exportAgent()` round-trip
  - **PR 2 (agent-store + run-store):** DB schema for `agents`, `agent_versions`, `node_executions`; CRUD
  - **PR 3 (DAG executor):** topological walk, per-node record writes, trust-source propagation (lifted from `chain-executor`), `{{upstream.<nodeId>.result}}` template substitution
  - **PR 4 (migration + CLI):** auto-merge v1 YAML chains into DAG-agents; `sua workflow` verbs
  - **PR 5 (dashboard viz):** Cytoscape-rendered DAG on `/agents/:id`, per-node execution table on `/runs/:id`

  ### What's in this PR

  - `Agent` / `AgentNode` / `AgentStatus` / `NodeOutput` / `NodeExecutionRecord` / `AgentVersion` types
  - Zod schema with:
    - Unique node ids, valid `dependsOn` references, cycle detection
    - Template validation: `{{inputs.X}}` must be declared; `{{upstream.Y.result}}` must be a declared upstream node
    - Shell-command template rejection (same env-var convention as v1)
    - Sensitive-env input name shadowing rejection (reuses v1's `SENSITIVE_ENV_NAMES`)
    - Cron cap (reuses v1's `validateScheduleInterval`)
  - `parseAgent(yaml): Agent` with a typed `AgentYamlParseError` carrying validation issues
  - `exportAgent(agent): string` with stable key order for git-diff-friendly output
  - `exportAgents(agents): Map<filename, yaml>` for dumping a whole workspace

  36 new tests (24 schema + 12 YAML round-trip). 302 → 338 repo-wide.

  ### Why YAML stays a first-class concern

  Per the v0.13 plan: DB is editable runtime state; YAML is the lossless serialization format for git, portability, and review. `parse(export(a)) ≈ a` for every valid `Agent` is a test invariant. Stable key order + omit-undefined-fields keeps diffs predictable.

  ### Template vocabulary recap

  - `{{inputs.X}}` — agent-level caller-supplied input (caller passes `--input X=value`)
  - `{{upstream.<nodeId>.result}}` — upstream node's stdout within this agent (claude-code only; shell nodes read `$UPSTREAM_<NODEID>_RESULT` env vars)
  - `{{outputs.X.result}}` (v1 cross-agent) — removed. Migration in PR 4 rewrites these as `{{upstream.X.result}}` within merged agents.

## 0.12.0

### Minor Changes

- a84193d: **feat: RunStore.queryRuns + shared HTTP auth module.** Foundation for the v0.12.0 dashboard — no user-facing behavior changes yet, but two pieces are now ready for the dashboard to build on:

  ### `RunStore.queryRuns({ filter })`

  Richer run-query API with filter composition, offset pagination, and a total-count return. Supersedes `listRuns` for the dashboard's `/runs` page (and any caller that needs paged output without a second COUNT query):

  ```ts
  const { rows, total } = store.queryRuns({
    agentName: "hello",
    statuses: ["completed", "failed"], // OR within statuses
    triggeredBy: "schedule",
    q: "abc", // prefix on id OR substring on agentName (case-insensitive)
    limit: 50,
    offset: 0,
  });
  ```

  - All filter fields compose with `AND`; `statuses[]` OR's within itself
  - `q` escapes SQL `LIKE` metacharacters so `50%` matches `"50%-win"` literally instead of every row
  - `limit` is clamped to `MAX_RUNS_LIMIT = 500`; `DEFAULT_RUNS_LIMIT = 50`
  - Two new indexes (`idx_runs_triggeredBy`, `idx_runs_startedAt` — DESC for the newest-first default) keep filter + order costs cheap
  - `distinctValues(column)` helper enumerates seen agents / statuses / triggeredBy values for dropdown population; the column name is allowlist-checked so there's no SQL-injection surface from the string

  Existing `listRuns` is untouched — MCP server, CLI `status`/`logs`/`cancel` keep working. Migration to `queryRuns` is opt-in per caller.

  ### Shared HTTP loopback auth (`@some-useful-agents/core/http-auth`)

  The `checkAuthorization`, `checkHost`, `checkOrigin`, and `buildLoopbackAllowlist` helpers that lived in `packages/mcp-server/src/auth.ts` are now in core. Same implementations, same tests (via the existing mcp-server suite). The mcp-server's `auth.ts` is now a thin re-export so existing internal imports keep working unchanged. New `checkCookieToken` sibling for cookie-based auth (the dashboard's case).

  Why: the dashboard needs the same three checks. Having it import from `@some-useful-agents/mcp-server` would couple a human-facing HTML surface to a programmatic-API package for a concern that belongs at the shared layer.

- 689b77a: **feat: `sua dashboard start` — read-only web UI with run-now + runs filter/pagination.** Closes v0.12's scope: a monitoring + nudge surface that complements the CLI without duplicating it.

  ### What ships

  - `sua dashboard start [--port 3000] [--host 127.0.0.1]` boots an Express app that shares the MCP bearer token at `~/.sua/mcp-token` for auth. Prints a one-time sign-in URL; cookie is the token itself, `HttpOnly` + `SameSite=Strict`, 8-hour expiry.
  - **Routes:** `/` redirects to `/agents`; `/agents` lists everything loadable with type/source badges; `/agents/:name` shows resolved YAML, declared inputs, live secrets-status (green/red/"unknown (store locked)" when v2 passphrase-protected), recent runs, run-now button.
  - **`/runs` — runs list with filters and pagination.** Agent dropdown + Triggered-by dropdown + multi-status checkboxes (OR within, AND across) + free-text `?q=` that prefix-matches on run id and substring-matches on agent name (case-insensitive). `?limit=` default 50, max 500. `?offset=` Prev/Next links preserve all filter state through the URL query string.
  - **`/runs/:id` — run detail** with status badge, timing, output frame, error pane. In-progress runs inline a 2-second poll via vanilla JS that swaps the container fragment without a full page reload.
  - **Run-now gate.** Local/examples agents submit directly. Community shell agents show a modal with the command and require an explicit audit checkbox before submit; the server double-checks `confirm_community_shell=yes` on the POST. Provider-level `UntrustedCommunityShellError` still applies — the modal is a UX, not a security, gate.
  - **Defenses** match MCP: `127.0.0.1` bind by default, Host + Origin allowlists (identical to the MCP server's, now shared via `@some-useful-agents/core/http-auth`), cookie-based session, CSRF defense via Origin check.

  ### New types + API

  - `Run.triggeredBy` adds `'dashboard'` to the union.
  - New `DashboardContext` exported from `@some-useful-agents/dashboard` for test harnesses that want to drive `buildDashboardApp(ctx)` via supertest without spinning an HTTP listener.

  ### Dependencies

  Adds `supertest` + `@types/supertest` (dev) to the dashboard package. Runtime deps unchanged — the UI is tagged template literals + inlined CSS/JS, no framework, no bundler, no CDN.

  ### Tests

  `packages/dashboard/src/dashboard.test.ts` — 15 supertest cases covering auth flows (cookie round-trip, Host/Origin rejection, wrong-token 401), filter routing (agent / status OR / unknown-status defense / pagination link preservation), and the run-now gate (community modal refusal without confirm, provider gate still fires with confirm).

  302 tests total across the repo (was 287; +15 new).

  ### Out of scope (deferred)

  - Custom-input form for run-now (YAML defaults only, as in the plan)
  - Editing YAML or setting secrets from the UI
  - Mermaid topology view of agent chains (planned for v0.13 alongside LLM-discoverable docs)

  ### Manual verify

  ```bash
  cd /tmp && mkdir sua-play && cd sua-play
  sua init
  sua agent run hello
  sua dashboard start --port 3000
  # Click the printed auth URL → cookie set → bookmark /
  # Explore /agents, /runs, try the run-now button.
  ```

## 0.11.0

### Minor Changes

- a21055c: **feat: agent lifecycle verbs — `edit`, `disable`, `enable`, `list --disabled`.** A set of small commands for the day-to-day "I want to tweak this agent without memorizing paths, or pause it without losing the YAML" flows.

  ### `sua agent edit <name>` — open the YAML in $EDITOR Resolves the agent name to its source file, spawns `$EDITOR`(or`$VISUAL`, falling back to `vi`on Unix /`notepad`on Windows), then re-parses and validates on save. Validation errors name the offending field and the file path so you can jump back and fix without waiting for`sua agent run` to surface the problem.

  ```bash
  sua agent edit hello                       # open in $EDITOR
  sua agent edit hello --print-path          # just print the resolved path
  code "$(sua agent edit hello --print-path)"   # hand the path to VS Code
  ```

  Under the hood, `AgentDefinition.filePath` is now populated by the loader (runtime-only metadata, not part of the on-disk schema) so `audit`, `doctor`, and any future `agent edit`-adjacent verbs have a single source of truth for "where did this agent come from." Non-TTY invocations print the path to stdout instead of spawning an editor — lets you compose with other tools without interactive state.

  When the named agent isn't found but there's a matching file on disk that the loader skipped (invalid YAML, failed schema check), the error now names those files and their loader warnings so broken edits don't silently disappear from `sua agent list`.

  ### `sua agent disable <name>` / `sua agent enable <name>` — pause without deleting

  ```bash
  sua agent disable claude-test    # renames to claude-test.yaml.disabled → loader skips it
  sua agent list --disabled        # see what's paused
  sua agent enable claude-test     # rename back
  ```

  The loader already ignores anything that isn't `.yaml` / `.yml`, so the `.disabled` suffix is the only state change — no schema fields, no hidden files. Examples (bundled) agents refuse to disable; community agents refuse by default with `--force` to override. Disabling a scheduled agent prints a reminder to restart any running `sua schedule start` daemon so it drops the in-memory cron job.

  `enable` matches on the YAML's declared `name:` field rather than the filename, so renaming the file independently of the agent name still works. Conflicts (disabling when `.disabled` already exists, enabling when a new `.yaml` has claimed the slot) refuse with a clear "resolve manually" message rather than clobbering either file.

### Patch Changes

- ad651db: **fix: don't open the secrets store for agents that declare no secrets.**

  v0.10.0 regression: `LocalProvider.submitRun` and `runAgentActivity` both called `secretsStore.getAll()` unconditionally for every run, which meant any agent — even one with no `secrets:` field — needed the store to be unlockable. On a v2 passphrase-protected store that turned every run into "set SUA_SECRETS_PASSPHRASE or nothing works", which was never the intent.

  Now the store is only opened when the agent actually declares secrets. Regression test in `local-provider.test.ts` uses a store that throws on any read and asserts the provider never touches it for an agent with no `secrets:` field.

## 0.10.0

### Minor Changes

- b855d95: **security: passphrase-based KEK for the secrets store (v0.10.0).** Closes the last finding from the original `/cso` audit. `data/secrets.enc` now encrypts under a key derived from a user passphrase via scrypt (N=2^17, r=8, p=1) with a per-store random salt, instead of the v1 hostname+username seed. A payload-exfil attacker can no longer decrypt the store by guessing trivially-known machine attributes.

  ### What changed

  - New v2 payload format: `{ version: 2, salt, iv, tag, data, kdfParams, obfuscatedFallback? }`. Salt and KDF parameters live alongside the ciphertext so we can tune scrypt upward in future versions without breaking old stores — readers honor whatever the file says.
  - Passphrase prompt on `sua secrets set` against a cold or v1 store. Confirmed twice before write. An empty passphrase explicitly opts into the legacy hostname-derived key and writes `obfuscatedFallback: true` into the payload so every subsequent read loudly warns.
  - New `sua secrets migrate` command: decrypt a v1 or v2-obfuscatedFallback store with the legacy key, re-encrypt under a new passphrase. Atomic via tempfile + rename.
  - `sua doctor --security` reports the store's encryption mode: `v2 passphrase-protected` (green), `v2 obfuscatedFallback` / `legacy v1` (red, points at `sua secrets migrate`).
  - `SUA_SECRETS_PASSPHRASE` environment variable is read by every code path that opens the store — required for CI/non-TTY contexts running scheduled agents against a v2 passphrase-protected store.
  - Legacy v1 payloads still decrypt for reads (with a warning on every load). First write auto-migrates to v2 under whatever passphrase the caller provides; run `sua secrets migrate` to upgrade without having to set a new secret first.

  ### Migration

  If you have an existing v0.9.x install with a `data/secrets.enc` on disk:

  ```bash
  # Option A: explicit migrate
  sua secrets migrate

  # Option B: auto — the next `sua secrets set` or `sua secrets delete` migrates
  sua secrets set ANY_KEY
  ```

  Both routes prompt for a new passphrase (or accept an empty one to stay on the legacy hostname key with an on-by-default warning).

  ### CI / non-TTY

  Set `SUA_SECRETS_PASSPHRASE` in the environment. A non-TTY `sua secrets set` against a cold store without the env var exits 1 with a clear error. If you want to preserve the pre-v0.10 zero-friction behavior, set `SUA_SECRETS_PASSPHRASE=` (explicit empty string) — this is treated as "use the legacy hostname-derived key" and is labeled as such in both the payload and in `sua doctor --security`.

  ### Rejected alternatives

  - **`keytar` / OS keychain** — native dependency that breaks `npx` on fresh machines (libsecret missing on Linux, Rosetta issues on M-series Macs). We may revisit with a pure-JS implementation later; for now, passphrase with empty-fallback covers the threat model without native bindings.
  - **Auto-derived "machine key" from additional attributes** — still guessable for a targeted attacker. Passphrase is the honest primitive.

  ### Not in this release

  - `sua secrets rotate-passphrase` — planned for v0.11 or later.
  - Keyfile-as-alternative-to-env-var (`SUA_SECRETS_KEYFILE`) — planned for v0.11 or later.
  - Dashboard badge for store encryption mode — v0.11.0 consumes the state surfaced by this release.

## 0.9.0

### Minor Changes

- b80d772: **feat: typed runtime inputs for agents.** Callers can now supply named, typed values at invocation time and agents substitute them into prompts or read them as environment variables. Closes the "I want my agent to take a parameter" story.

  ### Declare once, use everywhere

  ```yaml
  name: weather-verse
  type: claude-code
  prompt: "Weather for zip {{inputs.ZIP}} as a {{inputs.STYLE}}."
  inputs:
    ZIP:
      type: number
      required: true
    STYLE:
      type: enum
      values: [haiku, verse, limerick]
      default: haiku
  ```

  ```bash
  sua agent run weather-verse --input ZIP=94110
  sua agent run weather-verse --input ZIP=10001 --input STYLE=limerick
  ```

  ### Two execution models, one declaration

  - **claude-code agents** — `{{inputs.X}}` in the prompt (and in `env:` values) is substituted before spawn. Claude reads the resolved text; no injection class because prompts aren't executed.
  - **shell agents** — declared inputs become env vars. Authors write `"$ZIP"` in their commands; bash handles quoting. `{{inputs.X}}` inside a shell `command:` is rejected at load time with a clear error pointing to the `$X` form.

  ### Types

  | `type`    | Accepts                                           | Notes                           |
  | --------- | ------------------------------------------------- | ------------------------------- |
  | `string`  | any string                                        | default if unspecified          |
  | `number`  | `Number(x)` must be finite; empty string rejected | renders as decimal string       |
  | `boolean` | `true/false/1/0/yes/no` (case-insensitive)        | renders as `"true"` / `"false"` |
  | `enum`    | values listed in the spec's `values` array        | must declare `values`           |

  Type is for _validation at the boundary_, not downstream coercion. Every resolved input renders as a string — `{{inputs.VERBOSE}}` with `VERBOSE=true` substitutes the literal text `"true"`.

  ### Precedence (highest wins)

  1. `sua agent run --input K=V` (per-invocation)
  2. `sua schedule start --input K=V` (daemon-wide override, applies to every fired run; agents that don't declare the input ignore it)
  3. YAML `default:` (per-agent)
  4. Else fail loudly (`MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`)

  ### Load-time checks

  - `inputs:` names must be `UPPERCASE_WITH_UNDERSCORES` (env-var convention)
  - `type: enum` must declare a non-empty `values:` array
  - Every `{{inputs.X}}` in prompt or `env:` values must appear in the `inputs:` block (typos caught before execution)
  - Shell `command:` cannot contain `{{inputs.X}}` — use `$X` instead

  ### Run-time checks

  Ordered: undeclared provided key → invalid type → missing required. All fail before spawn, recorded as a failed run in history.

  ### New exports from `@some-useful-agents/core`

  - `AgentInputSpec` type
  - `inputSpecSchema` — zod schema
  - `resolveInputs(specs, provided, options?)` — returns resolved string map or throws
  - `validateAndRender(name, spec, raw)` — single-value validator
  - `extractInputReferences(text)` — returns set of `{{inputs.X}}` names
  - `substituteInputs(text, resolved)` — applies the map to a string
  - `MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`
  - `RunRequest` — formalized `submitRun` request shape with optional `inputs`

  ### API changes (library consumers)

  - `Provider.submitRun(request: RunRequest)` — request type now has `inputs?: Record<string, string>`.
  - `ExecutionOptions.inputs?: Record<string, string>` on `executeAgent`.
  - `ChainOptions.inputs?: Record<string, string>` on `executeChain` — flows to every agent in the chain.
  - `LocalSchedulerOptions.inputs?: Record<string, string>` — daemon-wide overrides applied to every fired run.
  - Temporal activities/workflows carry `inputs` in their payload so workers on other hosts inherit the caller's input values.

  ### Docs

  - README commands table and full-fat YAML example updated to show `inputs:` and `--input`.
  - ROADMAP lists v0.9.0 under "Now".
  - `sua agent audit` prints declared inputs with types, defaults, required flags, and descriptions.

## 0.8.0

### Minor Changes

- a171b77: **feat(cli): visual polish pass across every command.** One voice, one look. No behavior changes, no API changes.

  ### What shipped

  - **New `packages/cli/src/ui.ts`** — shared helpers (`ui.ok`, `ui.fail`, `ui.warn`, `ui.info`, `ui.step`, `ui.section`, `ui.banner`, `ui.outputFrame`, `ui.kv`, inline helpers `ui.agent`/`ui.cmd`/`ui.dim`/`ui.id`). Every command now routes its status lines through these helpers instead of reaching for `chalk.green/red/yellow` directly.
  - **Unified emoji symbol set** — ✅ success, ❌ failure, ⚠️ warning, 💡 info, 🚀 next-step. Tutorial's 🎭 dad-joke flourish preserved. Output looks the same whether you run `sua init`, `sua doctor --security`, or `sua agent new`.
  - **Boxed daemon banners** — `sua mcp start`, `sua schedule start`, and `sua worker start` now print a `boxen` banner with the config details instead of loose dim-text lines. Adds one new dep (`boxen@^8`, ~8KB, no surprises).
  - **Custom top-level `sua --help`** — now includes an Examples block and pointers to `docs/SECURITY.md` + the repo. `showHelpAfterError(true)` so unknown commands print help automatically.
  - **Unified output frame** — `sua agent run` and `sua agent logs` both wrap captured stdout in `╭── output ──╮ / ╰────────────╯` (was duplicated ad-hoc dim dashes in both files).
  - **`sua agent audit` key/value rows** go through `ui.kv()` instead of a command-local `row()` helper.
  - **`STATUS_COLORS` centralized** — moved from `commands/status.ts` to `ui.ts` so `status`, `schedule`, and future surfaces agree on what color a `running` / `pending` / `failed` run is.

  ### Files touched

  **New:**

  - `packages/cli/src/ui.ts`
  - `packages/cli/src/ui.test.ts` — 20 tests, pure stdout capture, covers every helper.

  **Modified (every command):**

  - `packages/cli/package.json` — add `boxen` dep
  - `packages/cli/src/index.ts` — Examples block + `showHelpAfterError`
  - All 13 command files: `init.ts`, `list.ts`, `status.ts`, `run.ts`, `cancel.ts`, `logs.ts`, `mcp.ts`, `schedule.ts`, `worker.ts`, `secrets.ts`, `doctor.ts`, `audit.ts`, `new.ts`, `tutorial.ts`

  ### Tests

  196 total (was 176; +20 new in `ui.test.ts`). Zero existing tests changed — the polish doesn't alter any assertable behavior. Lint + build clean.

  ### User-visible diffs

  - Every success line is now `✅  Created foo.yaml` instead of green-only `Created foo.yaml`.
  - Every error line is `❌  Agent "foo" not found.` instead of `Error: Agent ...` / bare red.
  - Every warning is `⚠️  ...` instead of `Warning: ...`.
  - `sua mcp start` / `sua schedule start` / `sua worker start` print a cyan-bordered banner with host/port/paths.
  - `sua --help` ends with an Examples block.
  - Run output is framed in a unicode box.

  If you were grepping command output in scripts (you shouldn't be), those strings changed. No machine-readable output was altered (JSON / tables / exit codes are all identical).

  ### Non-goals

  Deferred — not in this PR:

  - Switching `readline/promises` → `@inquirer/prompts` for `sua agent new` / `sua tutorial` (UX shift, separate design pass).
  - Timing info on `sua agent run` (`"completed in 2.3s"`).
  - Progress bars for long chains.
  - Themeable colors via config.

## 0.7.0

### Minor Changes

- 51155a4: **feat: `sua agent new` — interactive agent scaffolder.** Graduates users from "I ran an example" to "I authored an agent" without hand-writing YAML. Closes the _Interactive agent creator_ roadmap item.

  ### What it does

  `sua agent new` walks through a short prompt flow:

  1. **Type** — shell or claude-code (default shell)
  2. **Name** — validated against `[a-z0-9-]+` at prompt time
  3. **Description** — optional one-liner
  4. **Command** (shell) or **Prompt + Model** (claude-code)
  5. **Customize more?** — gate to the advanced fields
     - Timeout (default 300s)
     - Cron schedule (5-field; the v0.4.0 frequency cap still applies)
     - Secrets (comma-separated uppercase names; invalid ones are ignored with a warning)
     - `mcp: true` opt-in for Claude Desktop exposure
     - `redactSecrets: true` for known-prefix scrubbing of output
  6. **Preview + confirm** — prints the resolved YAML, asks before writing
  7. **Write** — lands in `agents/local/<name>.yaml`, chmod-safe, overwrite-guarded

  Every emitted YAML is validated against `agentDefinitionSchema` _before_ the file is written — if validation fails (shouldn't, given the prompt guards), the command exits 1 without side effects.

  ### Why now

  The security PRs (v0.4.0 → v0.6.1) added fields to the schema that are easy to forget by hand: `mcp`, `allowHighFrequency`, `redactSecrets`. Having the creator land _after_ those PRs means the prompt flow covers the full schema from day one, rather than being retrofitted.

  ### Implementation notes

  - Pure `buildAgentYaml(answers)` function is exported for testing — given an answers object, it emits deterministic, validated YAML with a stable key order (identity → type → execution → scheduling → capabilities).
  - Interactive flow uses `node:readline/promises`, matching the pattern already in `sua tutorial`. No new prompt-library dependency.
  - The command is read-only until the user confirms at the very end, so Ctrl-C at any stage leaves the filesystem untouched.

  ### Tests

  14 new tests in `packages/cli/src/commands/new.test.ts`:

  - YAML round-trips through `yaml.parse` to the expected object (shell + claude-code minimums).
  - Key order is semantic and stable.
  - Optional fields are omitted when not set; `mcp: false` / `redactSecrets: false` don't clutter the output.
  - Shell and claude-code fields don't leak into each other.
  - Every emitted YAML parses AND validates through `agentDefinitionSchema` (parameterized across several answer shapes).
  - Schedules emitted by the creator pass the v0.4.0 cron frequency cap.

  176 total tests pass.

  ### Follow-up (not in this PR)

  The tutorial's "now make your own" stage-6 wrapper — the thing that invokes this verb from inside `sua tutorial` — stays on the roadmap. It's a guided wrapper around this verb, not a new capability; making `sua agent new` a first-class verb means it's reusable outside the tutorial too.

## 0.6.1

### Patch Changes

- 9875ca4: **Fix: community agents are now runnable from the CLI so the v0.6.0 shell gate is actually reachable.** Before this patch, `sua agent run <name>` and `sua schedule start` only loaded `agents/examples/` + `agents/local/` — community agents were visible via `sua agent list --catalog` but "not found" at run time. The shell gate in `executeAgent` was effectively dead code for the primary CLI flow (it still fired for Temporal activities and `executeChain`, both tested).

  Now the runtime commands load from `dirs.all` (runnable + catalog) and the shell gate enforces per-agent opt-in via `--allow-untrusted-shell <name>` exactly as the v0.6.0 docs promised.

  ### Behavior changes

  - `sua agent run <community-agent>` is now accepted at lookup time and refuses at execute time with the expected `UntrustedCommunityShellError` message. Opt in with `--allow-untrusted-shell <name>`.
  - `sua schedule start` will now fire community agents that have a `schedule:` field; the gate still refuses unaudited community shell.
  - `sua mcp start` exposes community agents that have `mcp: true` in their YAML (still filtered by the opt-in flag — no behavior change for agents without it).
  - `sua doctor --security` now counts community shell agents whether or not they've been copied into `agents/local/`.
  - `sua secrets check <name>` now works on community agents.

  ### Unchanged by design

  - `sua agent list` still defaults to `runnable` vs `--catalog` so users can tell their own agents apart from third-party catalog entries.
  - `sua agent audit <name>` already loaded both; unchanged.

  ### Docs

  - `docs/SECURITY.md` and `README` version labels updated from the aspirational `v0.5.1` (what the plan predicted) to `v0.6.0` (what actually shipped). Future passphrase-KEK work renumbered to `v0.7.0`.
  - Version history in SECURITY.md gets a new `v0.6.1` entry documenting the gate wiring fix.

  No API changes. No migration needed.

## 0.6.0

### Minor Changes

- d86595f: **Security: community shell agent gate + run-store hygiene + auditing surfaces.** Closes `/cso` findings #5 (shell sandbox — short-term gate) and #7 (run-store hygiene). Third and final wave of the security remediation plan before v0.6.0's passphrase-based secrets KEK.

  ### Behavior changes

  - **Community shell agents refuse to run by default.** `executeAgent` throws `UntrustedCommunityShellError` when an agent with `type: shell` and `source: community` reaches the executor without explicit opt-in. Opt in per-agent (not global) via the new `--allow-untrusted-shell <name>` flag on `sua agent run` and `sua schedule start`. The error message tells the user exactly how to proceed: audit the command, then re-run with the flag. The refusal is recorded in the run store as a failed run so it shows up in history.
  - **Run-store is locked down.** `data/runs.db` is `chmod 0o600` at create time. A startup sweep deletes rows older than `runRetentionDays` (default 30; configure in `sua.config.json` or via the `retentionDays` option on `RunStore`). `Infinity` disables the sweep.
  - **Opt-in secret redaction.** A new `redactSecrets: true` agent YAML field runs captured stdout/stderr through a known-prefix scrubber before the store records it. Targets AWS access key IDs (`AKIA…`), GitHub PATs (`ghp_…`), OpenAI / Anthropic keys (`sk-…` / `sk-ant-…` / `sk-proj-…`), and Slack tokens (`xoxb-`, `xoxp-`, `xapp-`). Intentionally narrow to avoid the false positives that kill generic "value > 20 chars" scrubbers.

  ### New CLI surfaces

  - **`sua agent audit <name>`** — read-only. Prints the resolved YAML with type, source, schedule, `mcp:`, `redactSecrets:`, secrets, envAllowlist, env, dependsOn, and the full `command:` or `prompt:`. Community agents get a loud warning footer explaining the `--allow-untrusted-shell` gate.
  - **`sua doctor --security`** — read-only. Checks chmod 0o600 on the MCP token, secrets store, and run-store DB; confirms the MCP bind host; lists community shell agents that would refuse to run; shows which agents are MCP-exposed. Non-zero exit when any check fails.

  ### API changes (for library consumers)

  - `executeAgent(agent, env, options?)` — new third argument `{ allowUntrustedShell?: ReadonlySet<string> }`. Community shell throws `UntrustedCommunityShellError` when the agent name is not in the set.
  - `LocalProvider` now accepts an options object as its third constructor arg: `{ allowUntrustedShell?, retentionDays? }`. The old two-arg form still works.
  - `TemporalProvider` accepts the same two options and propagates `allowUntrustedShell` through the workflow input so workers inherit the submitter's trust decision.
  - `RunStore` accepts a `{ retentionDays?: number }` options argument. Exposes `sweepExpired(days)` for manual invocation.
  - New exports from `@some-useful-agents/core`: `UntrustedCommunityShellError`, `ExecutionOptions`, `LocalProviderOptions`, `RunStoreOptions`, `DEFAULT_RETENTION_DAYS`, `redactKnownSecrets`.
  - New CLI helper: `createProvider(config, { providerOverride?, allowUntrustedShell? })`. The previous bare-string signature still works.

  ### Migration

  If you write shell agents under `agents/community/`, they will now refuse to run unless the caller passes `--allow-untrusted-shell <name>`. Either move the agent to `agents/local/` (treated as trusted) or audit and opt in per-invocation. Run `sua doctor --security` to see which agents are affected.

  If you want known-prefix redaction for an agent's output, add `redactSecrets: true` to its YAML. Default behavior is unchanged — existing agents keep storing output verbatim.

  `data/runs.db` will now be chmod 0600 and the startup sweep will delete rows older than 30 days. To change the window, add `"runRetentionDays": N` to `sua.config.json`; set it very large to effectively disable.

  Docs: `docs/SECURITY.md` and the README security notes are updated to reflect what shipped vs what remains on the roadmap.

## 0.5.0

### Minor Changes

- 3218194: **Security: chain trust propagation + MCP agent opt-in + threat model docs.** Closes `/cso` finding #4 and the MCP-scope portion of the remediation plan. Two behavior changes, one new default, and a new public doc.

  ### Behavior changes

  - **MCP agents must opt in to be callable.** Only agents with `mcp: true` in their YAML are exposed via the MCP server's `list-agents` and `run-agent` tools. Non-exposed agents respond as "not found" so a compromised client cannot enumerate your full catalog. Existing example YAMLs (`hello-shell`, `hello-claude`, `dad-joke`) ship with `mcp: true` so the tutorial keeps working; new agents scaffolded by `sua init` default to `mcp: false` with a commented hint.
  - **Community agent output flowing through chains is now treated as untrusted.**
    - Claude-code downstream prompts that consume `{{outputs.X.result}}` from a community-sourced X get a `[SECURITY NOTE]` prepended and the value wrapped in `BEGIN/END UNTRUSTED INPUT FROM X (source=community)` delimiters.
    - Shell downstream of a community upstream is **refused outright** with `UntrustedShellChainError`. This blocks the most direct RCE path (community output landing in a shell env var that a careless command could eval). Override via `executeChain`'s new `allowUntrustedShell: Set<agent-name>` option — per-agent, not global.
    - All chains, trusted or not, now receive `SUA_CHAIN_INPUT_TRUST=trusted|untrusted` in the downstream env so shell agents can branch.

  ### New documentation

  - **`docs/SECURITY.md`** — full threat model: intended use, trust rings, layered MCP defenses, chain trust propagation, env filtering, cron cap, supply-chain posture. Equally explicit about what sua does NOT defend against (shell sandbox, secrets-store encryption strength, run-output secrets, Temporal history, remote MCP, DoS) so operators can evaluate fit without reading the code.
  - **README** gains a four-sentence threat-model banner above the Quick start section, and the existing "Security notes" list is rewritten to reflect current reality.

  ### API changes (worth calling out for library consumers)

  - `ChainOutput` (new exported type) — the outputs map value is now `{ result, exitCode, source }`. The resolver uses `source` to decide whether to wrap.
  - `resolveTemplateTagged(template, outputs)` (new) — returns `{ text, upstreamSources: Set<AgentSource> }`.
  - `executeChain(agents, provider, triggeredBy, options)` — fourth argument is now an options object `{ allowUntrustedShell?, pollInterval? }`. The previous positional `pollInterval` signature is replaced. No internal callers exist so this is a clean break; adjust any direct consumers.
  - `UntrustedShellChainError` (new exported error) — thrown before the run starts.

  ### Migration

  If you author YAML agents: add `mcp: true` to any agent you want reachable from Claude Desktop or another MCP client. The CLI commands (`sua agent run`, `sua schedule start`, etc.) are unaffected.

  If you consume `@some-useful-agents/core` as a library: `executeChain`'s fourth arg became an options object, and the outputs map carries `source`. If you were passing a bare number for poll interval, wrap it as `{ pollInterval: n }`.

## 0.4.0

### Minor Changes

- dae7022: **Security: transport lockdown.** Closes findings #1, #3, #6, and #8 from the `/cso` audit. This is the first wave of security hardening that lands before the broader community-trial push. Three behavior changes worth noting up front, plus several invisible defenses.

  ### Behavior changes

  - **MCP server now binds to `127.0.0.1` by default.** Previously it bound to all interfaces (Node's default for `listen(port)` with no host), so anyone on the same Wi-Fi could POST to the MCP endpoint and execute any loaded agent with the user's secrets. The console log used to lie about this — it claimed `localhost` while binding everywhere. New `--host` flag on `sua mcp start` for users who genuinely need LAN exposure (prints a warning).
  - **MCP server now requires a bearer token** (`Authorization: Bearer <token>`). `sua init` and `sua mcp start` create a 32-byte token at `~/.sua/mcp-token` (mode 0600) on first run. Existing MCP clients (Claude Desktop, etc.) need to be updated with the new header — `sua mcp start` prints a ready-to-paste config snippet. Use `sua mcp rotate-token` to roll the token; `sua mcp token` prints the current value.
  - **Cron schedules now have a 60-second minimum interval.** node-cron silently accepted 6-field "with-seconds" expressions like `* * * * * *` (every second), which could melt an Anthropic bill. 5-field expressions (the standard) still pass unchanged. The new `allowHighFrequency: true` YAML field bypasses the cap with a loud warning logged on every fire.

  ### Invisible hardening

  - MCP server checks the `Host` header against a loopback allowlist (defense for the `--host` case).
  - MCP server checks the `Origin` header against the same allowlist (defends against DNS rebinding from a browser tab).
  - Each MCP session is pinned to the sha256 of the bearer token used to create it, so `rotate-token` cannot be abused to hijack live sessions.
  - Bearer comparison uses `crypto.timingSafeEqual` to avoid timing leaks.
  - `actions/checkout`, `actions/setup-node`, and `changesets/action` are now SHA-pinned in CI workflows so a compromise of those orgs can't silently ship malicious code through a moving tag. Dependabot opens weekly PRs to refresh the SHAs.
  - New `.github/CODEOWNERS` requires owner review for any change under `.github/workflows/` once the matching ruleset is enabled on `main`.

  ### Migration

  If you are using the MCP server today: after upgrading, run `sua mcp start` once to see the printed config snippet, paste the new `Authorization` header into your client config (Claude Desktop, etc.), and restart your client. If you have YAML agents with 6-field cron schedules, either move them to a 5-field schedule (recommended) or add `allowHighFrequency: true`.

  Audit report and full threat model: see the project's `/cso` workflow.

## 0.3.2

## 0.3.1

## 0.3.0

### Minor Changes

- 89fd40d: Onboarding walkthrough and local cron scheduler.

  - `sua tutorial`: 5-stage interactive walkthrough that ends with a real scheduled dad-joke agent. Type `explain` at any stage for a Claude or Codex deep-dive.
  - `sua init`: now scaffolds `agents/local/hello.yaml` so `sua agent list` is never empty on first run.
  - `sua schedule start|list|validate`: cron-based scheduler via `node-cron`. Agents with a `schedule` field now actually fire.
  - `sua doctor`: new checks for scheduler readiness, installed LLM CLIs, and scheduled agent validity.
  - New core modules: `LocalScheduler` and `invokeLlm` / `detectLlms` utilities.
  - `dad-joke` example agent in `agents/examples/`.
  - Public `ROADMAP.md` at the repo root.

## 0.2.0

### Minor Changes

- 3122f3f: Initial public release. Local-first agent playground with YAML agent definitions, CLI (`sua`), MCP server (HTTP/SSE), Temporal provider for durable execution, encrypted secrets store, and env filtering to prevent secret leakage to community agents.
