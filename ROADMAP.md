# Roadmap

A living document of where `some-useful-agents` is heading. Light on detail, heavy
on direction.

## Now (shipping in v0.3)

- **Onboarding walkthrough** — `sua tutorial` walks new users through 5 stages
  ending in a real, scheduled agent (dad-joke from icanhazdadjoke.com). Claude or
  Codex can enrich any stage on request via the `explain` prompt.
- **Local cron scheduler** — `sua schedule start` runs agents with `schedule` fields
  on cron expressions via [node-cron](https://github.com/node-cron/node-cron).
- **Dad-joke starter agent** — a concrete example that demonstrates scheduling and
  external API calls without any auth setup.

## Next (3–6 months)

- **Notifications** — `notify` field in agent YAML for handlers: Slack webhook,
  email, file append. Secrets infrastructure (encrypted store + env injection) is
  already in place, so handlers just read `SLACK_WEBHOOK` from env and POST.
- **Dashboard (Phase 3)** — read-only Express + HTML UI at `localhost:3000`. Shows
  agent list, run history, logs. Reuses the same run store the CLI writes to.
- **Agent registry** — `sua agent install <github-url>` fetches a YAML from a
  remote repo, validates with zod, drops it into `agents/local/`. Turns the
  community catalog into one-command installs.
- **OS keychain for secrets (Phase S3)** — optional `keytar`-backed store for
  stronger at-rest encryption than the current machine-bound file cipher.
- **Temporal scheduling** — use Temporal's Schedules API for agents running via
  the Temporal provider (so scheduling works without a local scheduler daemon).
- **n8n provider** — second workflow provider alongside Temporal, for visual
  pipeline users.

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
