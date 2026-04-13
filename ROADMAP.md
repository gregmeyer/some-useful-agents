# Roadmap

A living document of where `some-useful-agents` is heading. Light on detail, heavy
on direction.

## Now (v0.7.0 shipped)

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

## Next (3–6 months)

- **Notifications** — `notify` field in agent YAML for handlers: Slack webhook,
  email, file append. Secrets infrastructure (encrypted store + env injection) is
  already in place, so handlers just read `SLACK_WEBHOOK` from env and POST.
- **Dashboard (Phase 3)** — read-only Express + HTML UI at `localhost:3000`. Shows
  agent list, run history, logs. Reuses the same run store the CLI writes to.
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
- **Security audit follow-through** — `/cso` ran in v0.4.0 and the
  transport layer is now locked down (MCP bearer-token + loopback bind +
  Host/Origin checks; cron frequency cap). Remaining work, in priority
  order: chain trust propagation so community agent output is wrapped
  before downstream agents see it (with a hard block on community-shell
  downstream); first-class community shell-agent gate; run-store
  `chmod 0o600` + retention + known-prefix secret redaction; passphrase-
  based KEK for the secrets store (replaces today's hostname-derived
  obfuscation). Real filesystem/network sandbox for shell agents stays
  on the long list — it's a multi-day cross-platform effort.

## Maybe (6–12 months)

- **Agent marketplace web UI** — browsable community catalog outside GitHub.
- **Remote MCP access with auth** — expose the MCP server to remote clients via
  authenticated HTTPS.
- **Agent performance stats** — `sua agent stats <name>` for duration, success
  rate, output size, and (for claude-code agents) token usage.
- **Agent templates** — `sua agent create --from template/daily-digest` scaffolds
  new agents from curated templates.

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
