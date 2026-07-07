# Roadmap

A living document of where `some-useful-agents` is heading. Light on detail, heavy
on direction.

## Recently shipped

### Current cycle (v0.22 → v0.24, next release pending)
- **Custom OpenAI-compatible LLM providers + waterfall management** — run local / self-hosted models (llama.cpp, LM Studio, Ollama, vLLM, a Qwen GGUF, …) as first-class providers. Add an endpoint at `/settings/llm` (name / API base / model / optional key) with a reachability probe; it POSTs `/v1/chat/completions` and slots into the existing fallback waterfall. Plus per-provider **enable/disable** (flip Claude and Codex off to run local-only) — a disabled provider is off everywhere, including for nodes that pin it. Full guide: [docs/llm-providers.md](docs/llm-providers.md).
- **Stable machine-key secrets store** — the zero-passphrase fallback keyed off `hostname:username`, which broke agent runs whenever macOS flipped `os.hostname()`. It now derives from a stable per-vault machine key (self-heals existing vaults on first read; actionable error when a vault is genuinely unreadable).
- **Inbox triage matured** — triage can **resolve** a thread it has fully handled, **see a whole run's output** (not just the first ~2KB) to answer data questions, **write to dashboards** (add-tile / create), and **show an agent's widget inline** without re-running it. Stop halts the whole autonomous chain.
- **One dashboard surface (Mission Control home)** — `/` is the live board + an inbox-first "Ask sua" CTA + a global top-bar "needs you" badge; `/pulse` folds into `/`. Plus a full readability/sizing token sweep and an "Editorial Paper" appearance theme.

### v0.21
- **Inbox as the agent control plane** — `/inbox` is becoming the end-to-end surface for agent operations, not just a triage queue. Shipped: the build → commit → run → inline-widget loop, runnable agents (`permissions.inboxRunnable`) + request-to-run ("Enable & run"), bulk dismiss + search, and now **Phase 2 thread usability** — a derived thread summary plus thread actions to **reopen**, **summarize**, **fork to agent** (new thread carrying provenance), and **retarget** (point this thread at a different agent). Plan: [docs/inbox-control-plane.md](docs/inbox-control-plane.md).
- **Orphan reaper on dashboard boot + cancel SIGKILL escalation + new `'abandoned'` error category** — a `daemon restart` (or crash) used to orphan in-flight LLM children: the parent process died, the in-memory `setTimeout(SIGTERM)` armed in node-spawner went with it, the `runs` row sat at `status='running'` forever, and the child kept calling Anthropic for the full 13-minute hang we reproduced. On boot the dashboard now calls `reapOrphanedRuns()` against any non-terminal run, transitions the run + every still-running `node_executions` row to `failed` with `errorCategory='abandoned'`, and the cancel route's fallback finalizes node rows the same way. The cancel path in `spawnProcess` also mirrors the timeout path now: SIGTERM, then SIGKILL after 5s if the child is still alive. PR #363.
- **`Agent.timeoutSec` wall-clock ceiling + persisted child PID + reaper actually kills the orphan** — per-node `timeout:` protects against one node hanging; `Agent.timeoutSec:` is the umbrella that catches a 10-node DAG legitimately burning tokens past a sane cap. `executeAgentDag` arms an internal `AbortController` that fires on caller-abort OR the timeout, and propagates downstream. To stop the orphan token-burn — not just close the state row — `node_executions` gained `childPid` and `childStartedAtMs` columns; `spawnProcess` writes both the moment `spawn()` returns. The reaper now parses `ps -p <pid> -o etime=`, compares against the stored start time, and `SIGKILL`s the process if elapsed time matches (defends against PID reuse). `layout-planner.yaml` ships with `timeoutSec: 60` as the first user. PR #364.
- **`/scheduled` page + per-row Pause / Resume + widget includes paused** — the home Scheduled widget filtered to `status='active'`, hiding every paused-but-scheduled agent and making "where's my schedule?" hard to answer. New `/scheduled` page under the Agents tab strip lists every agent with a cron regardless of status, with one-click `Pause` (paused → cron stays declared, reversible) and `Resume` actions on each row. Schedule clearing stays on `/agents/:id/config` since it's less reversible. The home widget now includes paused agents (badged) and gains a "View all →" link. Routes are dedicated wrappers so they redirect back to `/scheduled` with a flash; idempotent + 404-safe. PR #365.
- **`/scheduled` Activate one-click on drafts + explanatory hints** — draft agents with `schedule:` declared were listed but inert ("scheduled in intent" but skipped by the scheduler), and the page didn't explain why; users saw a cron next to `—` in Next fire and reasonably asked "why hasn't this run?" Draft rows now render an **Activate** button next to Edit, `won't fire — status is draft` in Next fire (with a tooltip on hover), and `never` in Last fire carries a tooltip clarifying that the column counts only scheduler-triggered runs (manual runs via dashboard / CLI / MCP don't count). Same shape as Pause/Resume — a dedicated POST route + flipStatus helper covering verb copy ("Activated" vs "Resumed"). PR #366.
- **DAG zoom toolbar + bigger canvas + sticky Node execution header + typed filter** — the DAG viewer on `/runs/:id` rendered a 2-node graph in a 150px compact canvas with no zoom controls; dense DAGs needed a separate full-screen view to read. Default canvas is now 380px (compact: 240px), cytoscape `userZoomingEnabled` + `userPanningEnabled` flipped on, plus a floating `+ / ⧇ / −` toolbar in the bottom-right of the canvas. The Node execution panel header (title + search + status filter) sticks at `top: 0` while node cards scroll under it; an rAF-throttled scroll observer releases the upper DAG/Result sticky bar to `position: static` when the cards-section sentinel approaches its bottom edge so the two sticky surfaces don't fight for the viewport. PR #362.
- **Builtin tool docs accuracy pass** — six tool docs (`http-get`, `http-post`, `file-read`, `file-write`, `json-parse`, `json-path`) were drifted enough vs the authoritative `def(...)` schemas in `packages/core/src/builtin-tools.ts` to mislead an agent author: `http-post` claimed body was auto-encoded "no JSON auto-encoding; stringify upstream" (the opposite of the actual behaviour), `json-parse` documented a per-top-level-key output behaviour that never existed, `json-path` advertised `items[0]` bracket syntax it doesn't accept. Reconciled all six against the source. Doc-only PR. PR #361.

### v0.20
- **Build planner with critic loop + auto-retry** — `build-planner` agent + structural critic (`critiquePlan`) that catches schema-valid plans which fall apart on contact with reality (newAgent YAML missing required fields, dashboard refs to phantom agents, hallucinated `matchedAgents`). On critic failure the wizard re-fires the planner with formatted feedback up to twice; after exhaustion the user gets a "Commit anyway" override. Per-pipeline telemetry at `/metrics/planner` (first-attempt-clean rate, retry counts, commit rate). PRs #224, #227, #230.
- **Scheduler now fires v2 agents** — `loadAgents` silently skipped every wizard-built v2 agent, so `LocalScheduler` registered zero of them while the dashboard widget cheerfully reported "Scheduler running." Now loads from AgentStore alongside the v1 directory loader and fires v2 through `executeAgentWithRetry`. New `'idle'` heartbeat status when the daemon is alive but firing nothing, surfaced as an orange dot. PR #228.
- **`sua planner smoke`** — automated CLI that hits the running daemon and exercises every branch of the planner pipeline. Six server-side scenarios (happy path, retry, exhaustion, dismiss, empty-commit, HN-digest reproducer) plus two playwright-driven browser scenarios (warning UX, dismiss-mid-retry). Real LLM calls gated behind `--live`. PRs #229, #230.
- **`sua agent reimport <path>`** — refresh a v2 agent (or directory of them) in the run DB from on-disk YAML. Idempotent: created / updated / unchanged / failed per file. Closes the "edit YAML, nothing happens" papercut. PR #232.
- **Schedule editor in dashboard** — `/agents/<id>/config` Schedule card replaces hand-editing YAML. Server-side validation via `validateScheduleInterval`. Two latent bugs fixed along the way: `extractDag` was silently dropping `allowHighFrequency`; `updateAgentMeta` couldn't clear nullable fields. PR #234.
- **HTTP tools accept custom headers** — `http-get` / `http-post` `headers` input. Many APIs (icanhazdadjoke, GitHub, anything content-negotiating) return HTML instead of JSON without an explicit `Accept` header — agents used to fall back to shell `curl` nodes. Fixes `daily-joke` rendering the icanhazdadjoke web page on pulse. PR #233.
- **Interactive pulse tiles by default** — `outputWidget.interactive: true` flips parameterised pulse tiles into self-contained mini-apps with inputs form + run button. Eight bundled examples swept; both planner prompts now set the flag whenever the agent declares runtime `inputs:`. PRs #231, #232.
- **MCP shutdown handle** — `startMcpServer` returns `{ shutdown }` so tests release the http server cleanly; replaced per-session `McpServer.close()` with `httpServer.closeAllConnections()` to avoid `SocketError: other side closed`. PRs #225, #226.

### v0.19
- **Daemon mode** — `sua daemon start|stop|status` runs the dashboard, scheduler, and MCP server detached in the background; clickable URL column; configurable dashboard port (#150, #155).
- **Notifications** — `notify` field on agents with Slack / file / webhook handlers; structured form editor in the dashboard replaces the JSON textarea; Slack messages link back to the run via `dashboardBaseUrl` (#151, #157, #165).
- **Agent install** — `sua agent install <github-url>` and a dashboard `/agents/install` paste-and-confirm flow turn community YAMLs into one-command installs (#152).
- **Workflow deletion** — `sua workflow rm` plus dashboard danger-zone delete on the agent detail page (#162).
- **Interactive output widgets** — Pulse tiles become self-contained mini-apps with inputs form, run button, status polling, and re-render on completion. Form + result render together in idle, pre-filled with the previous run's inputs (#166–#169, #181).
- **Output Widget editor** — its own page with sub-tabs and a live preview in the editor (#180).
- **Run detail polish** — sticky DAG + result summary on scroll (#171).
- **MCP control surface** — `/settings/mcp` to start/stop the outbound MCP server; per-agent MCP exposure toggle on the Config tab; per-session `McpServer` fix; `run-agent` accepts inputs (#174, #175, #176, #178).
- **Agent Config UX** — two-column layout, status moved to header, primary discipline (#179).
- **Better shipped agents** — graphics-creator-mcp + agent-analyzer included as real examples (#170).
- **Refactor** — agents router and agent-detail view split by feature for maintainability (#173).

### v0.18
- **MCP servers as first-class** — paste an `mcpServers` config, import tools wholesale, manage the fleet from `/settings/mcp-servers`. [docs/mcp.md](docs/mcp.md).
- **HTML allowlist sanitizer** — zero-deps sanitizer for AI-generated widget templates. [ADR-0021](docs/adr/0021-html-allowlist-sanitizer.md).
- **Dashboard tabs on `/tools` + `/agents`** — User / Built-in / Examples / Community per-tab counts and pagination.
- **Enum input values editor** — full UI support for `type: enum` inputs with per-input values lists.

### v0.17
- **SSRF protection** — `http-get` / `http-post` validate DNS-resolved IPs, blocking private / loopback / link-local / cloud-metadata.
- **Auth token in URL fragment** — token never sent to server in HTTP requests, never logged, never leaked via Referrer.
- **Security headers everywhere** — CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy on all dashboard responses.

### v0.16
- **Tools + user tool registry** — 10 built-in tools (`shell-exec`, `claude-code`, `http-get/post`, `file-read/write`, `json-parse/path`, `template`, `csv-to-chart-json`). User-authored tools sit alongside. [docs/tools.md](docs/tools.md).
- **Flow control** — first-class node types: `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break`. `onlyIf` predicate edges. [docs/flows.md](docs/flows.md).
- **Global variables** — `.sua/variables.json` store + `sua vars` CLI + `/settings/variables`. Referenced as `$NAME` / `{{vars.NAME}}`.
- **Output widgets** — declarative renderers for run output: `raw`, `key-value`, `diff-apply`, `dashboard`, and `ai-template` (Claude-generated HTML). [docs/output-widgets.md](docs/output-widgets.md).
- **DAG executor refactor** — split the 1482-line monolith into 6 focused modules; `LlmSpawner` interface (claude + codex); `progressJson` column for real-time turn tracking; per-node `provider` field.

### v0.15
- **DAG agents** — agents are multi-node flows by default. Every node declares `dependsOn`; executor walks the topological order; dashboard renders Cytoscape DAG visualizations with click-to-replay.
- **Suggest improvements** — built-in `agent-analyzer` reviews an agent's YAML, auto-validates suggestions, applies with one click.

### v0.10–v0.14 (foundations)
- **Passphrase-based secrets KEK (v0.10)** — scrypt-derived key replaces the v1 hostname seed; `sua secrets migrate` upgrades in place; `obfuscatedFallback` for zero-friction demos. Closes the last `/cso` finding.
- **Typed runtime inputs (v0.9)** — agents declare `inputs:` with types (string/number/boolean/enum), defaults, and required flags; `sua agent run --input KEY=value`; `{{inputs.X}}` in prompts, `$X` env vars in shell.
- **CLI visual polish (v0.8)** — shared `ui.ts` helpers; one voice, one look across every command.
- **Interactive agent creator (v0.7)** — `sua agent new` walks through agent type, fields, validation; writes to `agents/local/`.
- **Community shell gate + run-store hygiene (v0.6)** — `--allow-untrusted-shell <name>`; `data/runs.db` chmod 0o600 + 30-day retention; opt-in `redactSecrets`; `sua agent audit`, `sua doctor --security`.
- **Chain trust + MCP scope (v0.5)** — UNTRUSTED delimiters around community output; community shell downstreams refused unless allow-listed; MCP only exposes opt-in agents (`mcp: true`). [docs/SECURITY.md](docs/SECURITY.md).
- **Transport lockdown (v0.4)** — MCP server binds 127.0.0.1 with bearer-token auth; Host/Origin allowlists defeat DNS rebinding; session-to-token binding.

## Now

**v0.21 polish + tool policies.** Run reliability (orphan reaper, agent timeoutSec, child-PID-aware reaper kill), the Scheduled-agents management surface, and the DAG zoom + sticky Node execution header all merged. Picking up **tool policies** next per the v0.20+ sequence: tool policies → outcome-driven flows → node discovery. Followup nice-to-haves that fell out of the v0.21 work: surface orphan-reaper stats (`runsReaped` / `pidsKilled`) on `/health` and the boot log; a `timeoutSec` editor in `/agents/:id/config` so wall-clock caps are settable without editing YAML; one-click "Clear schedule" on `/scheduled` rows (kept off the row today since it's less reversible than Pause).

## Next (3–6 months)

- **Tool policies** — access control + resource scoping for tools; generalizes the community-shell gate from a per-feature toggle to a first-class policy system. Would let MCP-imported tools and user-authored tools opt into stricter sandboxing without touching the executor. Plan: [`~/.claude/plans/tool-policies.md`](.) (local). ~1 week of focused work.
- **Outcome-driven flows (v0.20+)** — instead of hand-authoring a static DAG, the user declares what they want (goal + success criteria + constraints) and a built-in planner generates the flow at run time. After the run, an evaluator checks the criteria; failures trigger a re-plan. Bridges "I know what I want" and "I know the exact steps." Depends on tool policies + a shared Claude API integration. Plan: [`~/.claude/plans/outcome-driven-flows.md`](.) (local). ~3 weeks of focused work after dependencies. Already noted in-repo via #156, #158.
- **Variables editor refactor** — Output Widget editor moved to its own page with sub-tabs in #180; the matching Variables editor refactor is the leftover. Plan: [`~/.claude/plans/agent-config-editors-followup.md`](.).
- **First-Run Tour CTA** — onboarding polish; surface a guided first-run tour after install. Plan: [`~/.claude/plans/mellow-splashing-squirrel.md`](.).
- **Agents-as-packages** — npm-style mini-packages with manifest + assets + versioning. Big shape change; promote when a concrete trigger lands (e.g., a real package someone wants to publish). Plan: [`~/.claude/plans/agents-as-packages.md`](.).
- **Catalog + provenance** — `provenance_json` column on the `agents` table tracking origin (npm / local / community / examples). Sequenced with agents-as-packages.
- **OS keychain for secrets (Phase S3)** — optional `keytar`-backed store for stronger at-rest encryption than the current passphrase-derived file cipher.
- **Temporal scheduling** — use Temporal's Schedules API for agents running via the Temporal provider (so scheduling works without a local scheduler daemon).
- **n8n provider** — second workflow provider alongside Temporal, for visual pipeline users.
- **Tutorial resume** — save tutorial progress so re-running `sua tutorial` picks up at the last completed stage rather than restarting the prose from stage 1.
- **Tutorial "make your own" stage** — `sua tutorial` currently ends after scheduling the dad joke. Add a stage 6 that wraps `sua agent new` so users graduate from "ran examples" to "authored one myself" without leaving the walkthrough.
- **Parallel agents / swarms** — the chain-executor runs sequentially even for independent DAG nodes. First-class fan-out/fan-in (e.g., `parallel: [A, B, C]`) plus Temporal worker scaling. Separately consider whether inter-agent messaging during execution is in scope or left to chaining.
- **Security audit follow-through** — every original `/cso` finding is now closed (transport lockdown in v0.4, chain trust + MCP scope in v0.5, shell gate + run-store hygiene in v0.6.x, secrets KEK in v0.10). Remaining open work from later audits: real filesystem/network sandbox for shell agents (multi-day cross-platform effort, stays on the long list); a pure-JS keyring alternative to the passphrase env var; `sua secrets rotate-passphrase` as a convenience over `migrate`.

## Maybe (6–12 months)

- **Agent marketplace web UI** — browsable community catalog outside GitHub.
- **Remote MCP access with auth** — expose the MCP server to remote clients via authenticated HTTPS.
- **Agent performance stats** — `sua agent stats <name>` for duration, success rate, output size, and (for claude-code agents) token usage.
- **Agent templates** — `sua agent create --from template/daily-digest` scaffolds new agents from curated templates.
- **Users / groups / RBAC** — today sua is single-user: one local OS account, one bearer token shared between MCP and dashboard, no concept of identity or permissions. For shared / team deployments (single laptop with multiple collaborators, or eventual hosted mode), we'd need: per-user accounts with password or SSO, groups for grouping accounts, role-based permissions on agents (run / edit / delete / manage secrets), an audit log of who did what, and per-user secrets so credentials aren't shared across the team. Big shape change — touches secrets store, dashboard auth middleware, run-store attribution, and the MCP token model. Plan when there's a concrete multi-user use case driving it; until then, single-user is fine and the simpler surface is a feature, not a gap.

## Explicitly rejected

- **Slack OAuth** — incoming webhooks cover the local-tool use case with zero auth infrastructure. OAuth requires a registered app with a redirect URL, awkward for a CLI with no public web surface.
- **Bundling agents in the CLI npm package** — agents are per-user state; scaffolding happens via `sua init` and `sua tutorial`, not via shipped YAML files in `node_modules`.

## How we decide

- **Big calls** get an [ADR](docs/adr/) capturing context, decision, consequences.
- **Small calls** go in the commit message.
- **Direction changes** update this file.
