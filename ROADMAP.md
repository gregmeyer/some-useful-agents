# Roadmap

A living document of where `some-useful-agents` is heading. Light on detail, heavy
on direction.

## Recently shipped

### v0.19 (current)
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

**v0.19 shipped, post-release.** No active in-flight feature; picking the next bet from the list below.

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
