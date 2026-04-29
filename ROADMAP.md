# Roadmap

A living document of where `some-useful-agents` is heading. Light on detail, heavy
on direction.

## Recently shipped (v0.11 – v0.18)

- **DAG agents (v0.15)** — agents are multi-node flows by default. Every node declares `dependsOn`; executor walks the topological order; dashboard renders Cytoscape DAG visualizations with click-to-replay.
- **Tools + user tool registry (v0.16)** — 10 built-in tools (`shell-exec`, `claude-code`, `http-get/post`, `file-read/write`, `json-parse/path`, `template`, `csv-to-chart-json`). User-authored tools sit alongside. Full catalog at [docs/tools.md](docs/tools.md).
- **Flow control (v0.16)** — first-class node types: `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break`. `onlyIf` predicate edges. [docs/flows.md](docs/flows.md).
- **Global variables (v0.16)** — `.sua/variables.json` store + `sua vars` CLI + `/settings/variables`. Referenced as `$NAME` / `{{vars.NAME}}`.
- **Output widgets (v0.16+)** — declarative renderers for run output: `raw`, `key-value`, `diff-apply`, `dashboard`, and `ai-template` (Claude-generated HTML). [docs/output-widgets.md](docs/output-widgets.md).
- **MCP servers as first-class (v0.18)** — paste a `mcpServers` config, import tools wholesale, manage the fleet from `/settings/mcp-servers`. [docs/mcp.md](docs/mcp.md).
- **SSRF protection (v0.17)** — `http-get` / `http-post` validate DNS-resolved IPs, blocking private / loopback / link-local / cloud-metadata.
- **HTML allowlist sanitizer (v0.18)** — zero-deps sanitizer for AI-generated widget templates. [ADR-0021](docs/adr/0021-html-allowlist-sanitizer.md).
- **Dashboard tabs on `/tools` + `/agents` (v0.18)** — User / Built-in / Examples / Community per-tab counts and pagination.
- **Enum input values editor (v0.18)** — full UI support for `type: enum` inputs with per-input values lists.
- **Suggest improvements (v0.15)** — built-in `agent-analyzer` reviews an agent's YAML, auto-validates suggestions, applies with one click.

## Now (v0.10.0 shipped)

- **Onboarding walkthrough** — `sua tutorial` walks new users through 5 stages
  ending in a real, scheduled agent (dad-joke from icanhazdadjoke.com). Claude or
  Codex can enrich any stage on request via the `explain` prompt.
- **Local cron scheduler** — `sua schedule start` runs agents with `schedule` fields
  on cron expressions via [node-cron](https://github.com/node-cron/node-cron).
  Schedules under 60s require an explicit `allowHighFrequency: true` opt-in
  to avoid silent runaway-cost surprises.
- **Dad-joke starter agent** — a concrete example that demonstrates scheduling and
  external API calls without any auth setup.
- **Transport lockdown (v0.4.0)** — MCP server binds `127.0.0.1` by default
  with bearer-token auth in `~/.sua/mcp-token`, Host/Origin allowlists to
  defeat DNS rebinding, and session-to-token binding so `sua mcp rotate-token`
  cannot be hijacked. Closes the largest item from the `/cso` audit.
- **Chain trust + MCP agent scope (v0.5.0)** — community agent output flowing
  into claude-code downstreams is wrapped in UNTRUSTED delimiters; community
  shell downstream is refused unless explicitly allow-listed. MCP only exposes
  agents that opt in via `mcp: true` in their YAML. Full threat model at
  `docs/SECURITY.md`.
- **Community shell gate + run-store hygiene (v0.6.0/v0.6.1)** — community
  shell agents refuse to run without `--allow-untrusted-shell <name>`.
  `data/runs.db` is chmod 0o600 with a 30-day retention sweep. Opt-in
  `redactSecrets: true` scrubs known-prefix tokens (AWS, GitHub PAT, OpenAI,
  Slack) from captured output. New `sua agent audit` and `sua doctor --security`
  verbs for self-inspection.
- **Interactive agent creator (v0.7.0)** — `sua agent new` walks through type,
  name, description, command/prompt, and optional advanced fields
  (timeout, schedule, secrets, `mcp:`, `redactSecrets`), validates via
  `agentDefinitionSchema`, and writes to `agents/local/<name>.yaml`.
- **CLI visual polish (v0.8.0)** — shared `ui.ts` helpers unify every
  command's output. One voice, one look: ✅ / ❌ / ⚠️ / 💡 / 🚀 symbols,
  boxen-bordered banners for daemon startups, unified output frame for
  `sua agent run`, Examples block in `sua --help`.
- **Passphrase-based secrets KEK (v0.10.0)** — `data/secrets.enc` now
  encrypts under a passphrase-derived key (scrypt N=2^17, per-store random
  salt), replacing the v1 hostname+username seed. New payload version with
  `kdfParams` for future tunability. Empty-passphrase fallback is preserved
  for zero-friction demos but labeled as `obfuscatedFallback` in the payload
  and flagged red by `sua doctor --security`. `sua secrets migrate` upgrades
  v1 or obfuscated-fallback stores in place. CI/non-TTY contexts read
  `SUA_SECRETS_PASSPHRASE`. Closes the last finding from the original `/cso`
  audit; the SecretsStore description in `docs/SECURITY.md` is now honest.
- **Typed runtime inputs (v0.9.0)** — agents declare `inputs:` with types
  (string, number, boolean, enum), defaults, and required flags. Callers
  supply values via `sua agent run <name> --input KEY=value` (repeatable);
  scheduler daemons via `sua schedule start --input KEY=value` (global
  override). claude-code prompts read `{{inputs.X}}` templates; shell
  agents read `$X` env vars (idiomatic bash, no template-injection surface).
  Schema rejects templates in shell commands and undeclared references at
  load time; resolver rejects missing-required, bad-type, and undeclared
  provided values at run time.

## Next (3–6 months)

- **Notifications** — `notify` field in agent YAML for handlers: Slack webhook,
  email, file append. Secrets infrastructure (encrypted store + env injection) is
  already in place, so handlers just read `SLACK_WEBHOOK` from env and POST.
- ~~**Dashboard (Phase 3)**~~ **— shipped v0.12+.** Full-featured: agent CRUD, DAG viz, per-node editing, run history with replay, settings, tools page, MCP import, Pulse, output widgets. See [docs/dashboard.md](docs/dashboard.md).
- **Agent registry** — `sua agent install <github-url>` fetches a YAML from a
  remote repo, validates with zod, drops it into `agents/local/`. Turns the
  community catalog into one-command installs.
- **Daemon mode / unattended operation** — `sua schedule start` runs foreground
  today. First-class backgrounding: either a bundled `sua daemon start|stop|status`
  wrapper over pm2, or generators for `launchd` (macOS) and `systemd` (Linux)
  unit files. Needed so scheduled agents actually fire when the terminal is closed.
- **OS keychain for secrets (Phase S3)** — optional `keytar`-backed store for
  stronger at-rest encryption than the current machine-bound file cipher.
- **Temporal scheduling** — use Temporal's Schedules API for agents running via
  the Temporal provider (so scheduling works without a local scheduler daemon).
- **n8n provider** — second workflow provider alongside Temporal, for visual
  pipeline users.
- **Tutorial resume** — save tutorial progress so re-running `sua tutorial` picks
  up at the last completed stage rather than restarting the prose from stage 1.
- **Tutorial "make your own" stage** — `sua tutorial` currently ends after
  scheduling the dad joke. Add a stage 6 that wraps `sua agent new` so users
  graduate from "ran examples" to "authored one myself" without leaving the
  walkthrough. The verb shipped in v0.7.0; this is the guided wrapper.
- **Parallel agents / swarms** — the chain-executor runs sequentially even for
  independent DAG nodes. First-class fan-out/fan-in (e.g., `parallel: [A, B, C]`
  YAML field) plus Temporal worker scaling. Separately consider whether
  inter-agent messaging during execution is in scope or left to chaining.
- **Security audit follow-through** — with v0.10.0 shipping the secrets KEK,
  every original `/cso` finding is now closed (transport lockdown in v0.4.0;
  chain trust + MCP scope in v0.5.0; shell gate + run-store hygiene in
  v0.6.x; secrets KEK in v0.10.0). Remaining open work from later audits:
  real filesystem/network sandbox for shell agents (multi-day cross-platform
  effort, stays on the long list); a pure-JS keyring alternative to the
  passphrase env var; `sua secrets rotate-passphrase` as a convenience over
  `migrate`.

## Maybe (6–12 months)

- **Agent marketplace web UI** — browsable community catalog outside GitHub.
- **Remote MCP access with auth** — expose the MCP server to remote clients via
  authenticated HTTPS.
- **Agent performance stats** — `sua agent stats <name>` for duration, success
  rate, output size, and (for claude-code agents) token usage.
- **Agent templates** — `sua agent create --from template/daily-digest` scaffolds
  new agents from curated templates.
- **Users / groups / RBAC** — today sua is single-user: one local OS account, one
  bearer token shared between MCP and dashboard, no concept of identity or
  permissions. For shared / team deployments (single laptop with multiple
  collaborators, or eventual hosted mode), we'd need: per-user accounts with
  password or SSO, groups for grouping accounts, role-based permissions on
  agents (run / edit / delete / manage secrets), an audit log of who did what,
  and per-user secrets so credentials aren't shared across the team. Big shape
  change — touches secrets store, dashboard auth middleware, run-store
  attribution, and the MCP token model. Plan when there's a concrete
  multi-user use case driving it; until then, single-user is fine and the
  simpler surface is a feature, not a gap.

## Explicitly rejected

- **Slack OAuth** — incoming webhooks cover the local-tool use case with zero
  auth infrastructure. OAuth requires a registered app with a redirect URL,
  awkward for a CLI with no public web surface.
- **Bundling agents in the CLI npm package** — agents are per-user state;
  scaffolding happens via `sua init` and `sua tutorial`, not via shipped YAML
  files in `node_modules`.

## How we decide

- **Big calls** get an [ADR](docs/adr/) capturing context, decision, consequences.
- **Small calls** go in the commit message.
- **Direction changes** update this file.
