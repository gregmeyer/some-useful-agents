# Changelog

## 2026-05-23

### Integrations (v0.21.0, PRs #262-#272)
- `Settings → Integrations` tab: store and manage Slack / webhook / file destinations, then reference them by id from `notify` handlers
- Integration *kinds* that auto-generate tools: **CSV** (read/count), **Postgres** (find/count), **SQLite** (find/count) — connect a data source and get query tools for free
- Gmail via OAuth, exposed through the generic `mcp-tool` integration kind
- Schema-aware, save-time template validation against an integration's shape
- New `churn-watcher` example: SQLite integration → `llm-prompt` → metric widget

### LLM prompt unification (v0.21.0, PRs #294-#298)
- `llm-prompt` is now the canonical node/tool type; `claude-code` is preserved as an alias (existing agents keep working — see ADR 0023)
- Provider registry is the single source of truth for installed LLM providers; the Tools catalog surfaces them
- Bundled examples migrated to `type: llm-prompt`

### Per-node LLM options (v0.21.0, PRs #300-#302)
- Expose `model`, `maxTurns`, and `allowedTools` per node on the agent forms
- Advanced LLM options available on `/agents/new`, with a more prominent disclosure

### Output widgets (v0.21.0, PRs #278-#289)
- Controls render **everywhere** a widget renders, and the widget author owns their appearance via a `<style>` block
- New array controls: `sort`, `filter`, `paginate` — with per-field URL state
- First-class `table` field type for dashboard widgets, editable column-by-column in the Output Widget editor
- Edit all six control types + actions inline in the editor; Save preserves columns / controls / actions
- Templates: `{{#if item.X}}` / `{{#unless item.X}}` inside `{{#each}}`; leftover block tokens stripped instead of leaking; `<style>` blocks preserved with scrubbed bodies

### Improve layout wizard (v0.21.0, PRs #305-#324)
- New `LayoutPlan` schema + `layout-planner` agent + `computeLayoutSuggestions()` heuristic
- Wizard on `/pulse` **and any named dashboard** — starts from the current layout
- **Path A**: surface installed-but-absent agents (`toAdd`). **Path B**: draft brand-new agents inline (`needsNew`), reusing the build-from-goal drafter
- Curation mode (top agents visible, rest hidden on Apply), retry-with-feedback, "Refine this plan", parallel Cancel / Apply only / Draft+apply CTAs, schema auto-retry

### Build from a goal — orchestrator split (v0.21.0, PRs #326-#347)
- `build-planner` split into a server-side orchestrator: `goal-surveyor` → one `agent-drafter` per fragment (parallel, each behind its own structural critic) → `dashboard-designer`
- Per-drafter critic retry loop (re-fires the drafter on validation failure); ai-template path critic; external `<img>` host critic
- Pre-generated runId eliminates the kickoff race; YAML-parse retry + auto-run on land; partial-success screen for mixed draft outcomes; "Nothing to build" instead of a crash when the goal is already covered
- Planner loop internals: `PlannerLoopRunner`, smoke-run eval + telemetry, cross-run memory; `successCriteria` + `AgentLoopRunner` for generated agents

### Dashboards & Pulse (v0.21.0, PRs #236-#350)
- Run an agent **once automatically** when it's first added to a dashboard (no blank tiles)
- In-place "Run again" on tiles, one-click **allow** for CSP-blocked widget images, build stamp in `/health` + footer
- In-place "+ Add tile" modal on `/dashboards/:id` (offers a blank agent or build-from-goal); add-tile preset chips; choose where a build-from-goal result lands
- Edit-mode persists across reloads with a navigate-away guard; empty-dashboard delete prompt; in-app modals for tile removal
- Pulse tile chrome pinned with a scrollable body and sticky footer; `×` toggles `pulseVisible`; home tiles get palette + collapse parity
- Permissions card on the agent Config tab; agents declare CSP `img-src` allowlists via `permissions`; tool-usage visibility ("Used by" + canonical badges)

### Core / CLI / infra (v0.21.0)
- Scheduled agents fire on first daemon start instead of waiting until the next day (#244)
- `mcp-server` supports `port=0` and returns the bound port on its handle (#245)
- `sua agent audit` falls back to the project DB for dashboard-created agents (#304); execute bit preserved on `dist/index.js` across rebuilds (#299)
- Tool-policies groundwork: file shape + executor seam (always-allow stub) (#238)
- CI: gitleaks secret scan on push + PR (#261)

## 2026-04-21

### Security fixes (v0.17.0)
- SSRF protection on `http-get` and `http-post` tools: DNS-resolved IP validation blocks private, loopback, link-local, and cloud metadata addresses
- Auth token moved from URL query parameter to URL fragment: token never sent to server in HTTP requests, never logged, never leaked via Referrer headers
- CSP, X-Content-Type-Options, X-Frame-Options, and Referrer-Policy headers on all dashboard responses
- Docker Compose Postgres binds to `127.0.0.1` instead of all interfaces

## 2026-04-17

### Variables scoping (PRs #87-#92)
- Global variables store (`.sua/variables.json`) with `sua vars` CLI
- Executor wiring: `$NAME` in shell, `{{vars.NAME}}` in prompts
- Template palette autocomplete includes global variables with group separators
- `/settings/variables` dashboard tab with full CRUD
- Agent-detail Variables section: inline type editing, defaults, add-new-row
- Type/value validation on save (number/boolean defaults checked)
- YAML editor: GET/POST `/agents/:name/yaml` with Zod validation
- Secrets save modal: copy-before-save warning, value never shown again
- 3-layer secret redaction in run logs: declared secrets, sensitive name patterns, credential value patterns
- Edit links on variables in node edit form (agent inputs, global vars, secrets)

### Suggest improvements (PRs #93-#94, #101)
- "Suggest improvements" button on agent detail opens inline modal
- Agent-analyzer example: self-correcting 3-node pipeline (analyze, validate, fix)
- Modal shows real progress from `progressJson` while analyzing
- Side-by-side colored diff (red for removed, green for added)
- "Review + apply" opens YAML editor pre-filled with suggestions
- YAML validation with error display before apply

### DAG executor refactor (PRs #95-#99)
- Split 1482-line `dag-executor.ts` into 6 focused modules
- `LlmSpawner` interface with claude (stream-json) and codex implementations
- `progressJson` column on `node_executions` for real-time turn tracking
- Dashboard shows turn indicators on running nodes
- `provider` field on claude-code nodes: select claude or codex per node

### Dashboard UX (PRs #92, #93, #98)
- Run-now modal with input fields for agents that declare inputs
- Non-blocking run execution: immediate redirect to polling page
- Replay modal with pre-flight validation (upstream outputs + node config)
- Resolved variables panel on run detail with live filter
- Markdown rendering in analysis output
- CSS overflow fix for long variable values
- Spinner CSS component

### Example agents (PR #100)
- `llm-tells-a-joke`: configurable topic input, clean prompt rules

### Bug fixes
- Fixed `{{inputs.X}}` template resolution for claude-code node prompts
- Fixed inline onclick handlers breaking JS template literal parsing
- Fixed form disconnection on run-now submit (setTimeout defer)
- Fixed prefillYaml handler for Review + apply flow
