# some-useful-agents

A local-first agent playground. Author agents in YAML, run them from the CLI or MCP, schedule them on cron, chain them into pipelines, and share them with the community.

MIT-licensed. Published to npm at `@some-useful-agents/*`. Designed to feel like `cron + shell scripts` except each "script" can also be a Claude Code prompt and the whole thing is observable, durable, and composable.

> **Threat model in 30 seconds.** sua is a local-first tool for a single user on a
> machine they control. The MCP server binds `127.0.0.1` with a bearer token; only
> agents marked `mcp: true` are callable from MCP clients. Community shell agents
> refuse to run without explicit opt-in (`sua agent audit` + `--allow-untrusted-shell`);
> community output flowing into a claude-code prompt is wrapped in UNTRUSTED
> delimiters. Secrets are *obfuscated, not encrypted* until v0.7.0 lands
> passphrase-based key derivation. Run `sua doctor --security` to verify your
> install. Full model: [docs/SECURITY.md](docs/SECURITY.md).

## Quick start (no clone needed)

```bash
npm install -g @some-useful-agents/cli
mkdir my-agents && cd my-agents
sua init           # creates sua.config.json and agents/local/hello.yaml
sua tutorial       # 5-stage walkthrough ending with a scheduled dad joke
```

Prefer `npx`? `npx @some-useful-agents/cli <command>` works without installing globally.

The tutorial walks you through what sua is, builds a real agent that fetches a dad joke from icanhazdadjoke.com, and optionally schedules it daily at 9am. At any stage you can type `explain` to get a Claude or Codex deep-dive on that concept.

## Commands at a glance

**Agents**

```bash
sua agent list                # runnable agents (examples + local)
sua agent list --catalog      # browse the community catalog
sua agent run <name>          # run an agent once
sua agent status [runId]      # recent runs, or one specific run
sua agent logs <runId>        # stdout/stderr of a past run
sua agent cancel <runId>      # kill a running agent
```

**Scheduling**

```bash
sua schedule list             # agents with a schedule field + next fire time
sua schedule validate <name>  # validate the cron expression
sua schedule start            # foreground cron daemon
```

**Secrets** (encrypted at rest, scoped per-agent)

```bash
sua secrets set <NAME>        # prompts for value, stores encrypted
sua secrets get <NAME>
sua secrets list
sua secrets delete <NAME>
sua secrets check <agent>     # which secrets an agent needs + whether set
```

**Services**

```bash
sua mcp start                 # HTTP/SSE MCP server (port 3003)
sua worker start              # Temporal worker (requires docker compose up)
```

**Utilities**

```bash
sua init                      # scaffold a new sua directory
sua doctor                    # check Node, Docker, Claude CLI, scheduler, etc.
sua tutorial                  # guided walkthrough
```

## Agent YAML

A full-fat example showing most of the available fields:

```yaml
name: daily-summary
description: Summarize today's git activity with Claude
type: claude-code
prompt: |
  Summarize the recent commits. Keep it under 5 bullets.
  Commits:
  {{outputs.fetch-commits.result}}
model: claude-sonnet-4-20250514
dependsOn: [fetch-commits]        # chain: fetch-commits runs first
schedule: "0 18 * * *"            # daily at 6pm
timeout: 120
secrets:                          # resolved from the secrets store
  - GITHUB_TOKEN
envAllowlist:                     # extra process.env to inherit
  - HTTP_PROXY
author: your-github-handle
version: "1.0.0"
tags: [git, summary, daily]
```

Required fields: `name`, `type` (`shell` or `claude-code`). Shell agents need `command`; claude-code agents need `prompt`. Everything else is optional.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full schema and security review checklist.

## Running on Temporal

Use Temporal instead of the local child-process provider when you want durable, observable execution.

```bash
docker compose up -d                                # Temporal dev server
sua worker start                                     # worker runs on your host
sua agent run hello --provider temporal              # or set SUA_PROVIDER=temporal
open http://localhost:8233                           # Temporal Web UI
```

The worker runs on the host (not in Docker) because agents need your shell and your Claude CLI install. Temporal itself is the only thing running in Docker.

## Architecture

```
HOST MACHINE
+---------------------------------------------------------------+
|                                                               |
|  sua (CLI)    MCP server (HTTP)    Temporal worker            |
|      \             |                     /                    |
|       \            v                    /                     |
|        ----> packages/core <-----------                       |
|              AgentLoader                                      |
|              Provider (Local | Temporal)                      |
|              RunStore (node:sqlite, WAL)                      |
|              Scheduler (node-cron)                            |
|              SecretsStore (AES-256-GCM file)                  |
|                                                               |
|  Agent execution                                              |
|   - shell agents: child_process.spawn (on host)               |
|   - claude-code agents: spawn('claude', ['--print', prompt])  |
+-------------------------------+-------------------------------+
                                | localhost:7233 (gRPC)
                       +--------v--------+
                       |    DOCKER       |
                       |  Temporal       |
                       |  (SQLite, :8233)|
                       +-----------------+
```

All infrastructure except Temporal runs on the host. See [ADR-0004](docs/adr/0004-temporal-worker-on-host.md) for why.

## Packages

| Package | Install | Purpose |
|---------|---------|---------|
| `@some-useful-agents/cli` | `npm i -g @some-useful-agents/cli` | the `sua` binary |
| `@some-useful-agents/core` | `npm i @some-useful-agents/core` | types, schemas, run store, scheduler — build on top |
| `@some-useful-agents/mcp-server` | auto via CLI | MCP server (HTTP/SSE) |
| `@some-useful-agents/temporal-provider` | auto via CLI | Temporal workflows + worker |
| `@some-useful-agents/dashboard` | not yet | (roadmap: Phase 3 web UI) |

All packages are published via OIDC with provenance attestations — verify with `npm view @some-useful-agents/cli attestations`.

## Security notes

See [docs/SECURITY.md](docs/SECURITY.md) for the full threat model. One-liners:

- **Env filtering by trust level** — community agents receive a minimal env (`PATH`, `HOME`, `LANG`, `TERM`, `TMPDIR` + allowlist). Dangerous vars like `AWS_SECRET_ACCESS_KEY` do not leak. See [ADR-0006](docs/adr/0006-env-filtering-by-trust-level.md).
- **MCP bearer token + loopback bind** — v0.4.0 closed a critical gap. `sua init` writes a 32-byte token to `~/.sua/mcp-token` (chmod 0600); the server binds `127.0.0.1`, requires `Authorization: Bearer <token>`, and rejects non-loopback Host/Origin headers.
- **MCP agents opt in** — only agents with `mcp: true` in their YAML are exposed via MCP's `list-agents` and `run-agent` tools (v0.5.0). The rest are invisible to MCP clients.
- **Chain trust propagation** — community agent output flowing into a downstream local agent is wrapped in UNTRUSTED delimiters (claude-code) or blocked outright (shell), unless the shell downstream is explicitly allow-listed (v0.5.0).
- **Community shell agent gate** — shell agents sourced from `agents/community/` refuse to run without `--allow-untrusted-shell <name>` on the CLI. Use `sua agent audit <name>` to print the resolved YAML before opting in (v0.6.0, wired end-to-end in v0.6.1).
- **Run-store hygiene** — `data/runs.db` is chmod 0o600 at create. Rows older than `runRetentionDays` (default 30) are swept on startup. Opt-in `redactSecrets: true` on an agent scrubs known-prefix secrets (AWS, GitHub PAT, OpenAI / Anthropic, Slack) from its stdout/stderr before they land in the DB (v0.6.0).
- **Cron frequency cap** — schedules fire no more than once per minute by default. 6-field sub-minute expressions require `allowHighFrequency: true` and emit a loud warning on every fire (v0.4.0).
- **Secrets store** — machine-bound AES-256-GCM at `data/secrets.enc`, permissions `0600`. Obfuscation-grade, not vault-grade; passphrase-based key derivation is on the v0.7.0 roadmap. See [ADR-0007](docs/adr/0007-encrypted-file-secrets-store.md).
- **Self-check** — run `sua doctor --security` for a one-shot audit of file perms, MCP token presence, and community shell posture.
- **Known-weak (still)** — the shell-agent Docker sandbox documented in [ADR-0005](docs/adr/0005-shell-sandbox-claude-on-host.md) remains aspirational; once you opt in past the community-shell gate, the agent runs with your full ambient authority. Don't install community agents you haven't audited.

## Where is this going?

- [ROADMAP.md](ROADMAP.md) — direction at three horizons (now / next / maybe) and what we've rejected
- [docs/adr/](docs/adr/) — 13 architecture decision records explaining the "why" behind big calls

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TL;DR: fork, branch, add a `changeset` describing your change (`npx changeset`), open a PR against `main`. Agent contributions go in `agents/community/` and need a security review checklist.

## License

MIT
