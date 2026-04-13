# some-useful-agents

A local-first agent playground. Author agents in YAML, run them from the CLI or MCP, schedule them on cron, chain them into pipelines, and share them with the community.

MIT-licensed. Published to npm at `@some-useful-agents/*`. Designed to feel like `cron + shell scripts` except each "script" can also be a Claude Code prompt and the whole thing is observable, durable, and composable.

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

- **Env filtering by trust level** — community agents receive a minimal env (`PATH`, `HOME`, `LANG`, `TERM`, `TMPDIR` + allowlist). Dangerous vars like `AWS_SECRET_ACCESS_KEY` do not leak. See [ADR-0006](docs/adr/0006-env-filtering-by-trust-level.md).
- **Encrypted secrets store** — machine-bound AES-256-GCM at `data/secrets.enc`, permissions `0600`. Obfuscation-grade, not vault-grade; OS keychain is on the roadmap. See [ADR-0007](docs/adr/0007-encrypted-file-secrets-store.md).
- **Known-weak** — the shell-agent Docker sandbox is documented in [ADR-0005](docs/adr/0005-shell-sandbox-claude-on-host.md) but not yet implemented; the MCP server has no auth; template substitutions in chains aren't shell-escaped. See ROADMAP "Security audit" item.

## Where is this going?

- [ROADMAP.md](ROADMAP.md) — direction at three horizons (now / next / maybe) and what we've rejected
- [docs/adr/](docs/adr/) — 13 architecture decision records explaining the "why" behind big calls

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TL;DR: fork, branch, add a `changeset` describing your change (`npx changeset`), open a PR against `main`. Agent contributions go in `agents/community/` and need a security review checklist.

## License

MIT
