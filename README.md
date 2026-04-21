# some-useful-agents

A local-first agent playground. Author agents as composable flows, run them from the CLI or MCP, schedule them on cron, chain them into multi-step pipelines with branching and loops, and manage everything from a web dashboard.

MIT-licensed. Published to npm at `@some-useful-agents/*`.

## What you get

- **Agents as flows** — each agent is a DAG of nodes. Nodes execute shell commands, Claude Code prompts, or named tools. Flow control (conditional, switch, loop, agent-invoke, branch, end, break) lets agents make decisions and orchestrate sub-agents.
- **Multi-provider LLM support** — claude-code nodes can use Claude or Codex via the `provider` field. Stream-json progress tracking shows real-time turn status during execution.
- **9 built-in tools** — `shell-exec`, `claude-code`, `http-get`, `http-post`, `file-read`, `file-write`, `json-parse`, `json-path`, `template`. User-authored tools sit alongside in `tools/`.
- **Dashboard** — web UI for managing agents, tools, runs, secrets, variables, and settings. Visual DAG editor, click-to-replay, YAML editor, template palette autocomplete, per-node action dialogs.
- **AI suggest improvements** — one-click agent analysis via the built-in `agent-analyzer`. Reviews your agent's YAML, classifies changes as "no improvements" / "suggestions" / "recommend rewrite", shows a colored diff, and auto-validates + fixes the suggested YAML before presenting it.
- **Global variables** — plain-text, non-sensitive values available to every agent. CRUD via `/settings/variables` or `sua vars` CLI. Referenced as `$NAME` in shell, `{{vars.NAME}}` in prompts.
- **MCP server** — expose agents to Claude Desktop and other MCP clients over HTTP/SSE.
- **Secrets store** — passphrase-encrypted at rest (scrypt N=2^17). Dashboard CRUD with copy-before-save modal and 3-layer redaction (declared secrets + sensitive name patterns + credential value patterns).
- **Scheduling** — cron expressions on any agent. Temporal provider available for durable workflows.
- **9 bundled examples** — from "hello world" to conditional routing to AI-powered agent analysis. Auto-installed on `sua init`.

## Quick start

```bash
npm install -g @some-useful-agents/cli
mkdir my-agents && cd my-agents
sua init                    # creates project + installs example agents
sua workflow run hello      # run your first agent
sua dashboard start         # open the web dashboard
```

Prefer `npx`? `npx @some-useful-agents/cli@latest init` works without installing globally.

## Example agents

Installed automatically by `sua init`. Manage with `sua examples install/remove/list`.

| Agent | What it teaches |
|---|---|
| `hello` | Your first agent, single shell node |
| `two-step-digest` | Chain nodes with `dependsOn` + upstream output passing |
| `daily-greeting` | Cron scheduling (`schedule: "0 8 * * *"`) |
| `parameterised-greet` | Agent inputs with defaults (`--input NAME=Greg`) |
| `conditional-router` | Flow control: conditional + onlyIf + branch merge |
| `research-digest` | Agent-invoke + loop (nested sub-flows) |
| `daily-joke` | HTTP tool fetching from icanhazdadjoke.com |
| `parameterised-greet-claude` | Claude Code companion (requires API key) |
| `llm-tells-a-joke` | Configurable topic input + clean prompt design |
| `agent-analyzer` | Self-correcting 3-node pipeline: analyze, validate, fix |
| `agent-builder` | Goal-driven wizard, builds agents from plain language |
| `system-health` | Disk/memory/CPU check with Pulse metric tile |
| `daily-summary` | Activity summary with Pulse text-headline tile |

## CLI commands

### Agents

```bash
sua agent list                          # all agents (examples + local)
sua agent new                           # interactive scaffold
sua agent run <name>                    # run once
sua agent run <name> --input K=V        # supply inputs
```

### Workflows (DAG agents)

```bash
sua workflow list                       # DAG agents in the store
sua workflow run <id>                   # execute a flow
sua workflow replay <runId> --from <nodeId>  # replay from a node
sua workflow import-yaml <file>         # import a v2 YAML into the store
```

### Tools

```bash
sua tool list                           # built-in + user tools
sua tool show <id>                      # inspect inputs/outputs
sua tool validate <file>                # schema-check a tool YAML
```

### Examples

```bash
sua examples install                    # import all bundled examples
sua examples remove                     # remove example agents from DB
sua examples list                       # show install status
```

### Variables

```bash
sua vars list                           # all global variables (names + values)
sua vars get <NAME>                     # get a variable's value
sua vars set <NAME> <VALUE>             # set/update a variable
sua vars delete <NAME>                  # remove a variable
```

### Secrets

```bash
sua secrets set <NAME>                  # store an encrypted secret
sua secrets list                        # list names (values hidden)
sua secrets delete <NAME>               # remove a secret
```

### Infrastructure

```bash
sua init                                # initialize a project
sua doctor                              # check prerequisites
sua mcp start                           # start the MCP server
sua dashboard start                     # start the web dashboard
sua schedule list                       # show scheduled agents
```

## Dashboard

Start with `sua dashboard start`. Dark mode by default, JetBrains Mono, warm stone neutrals.

- **Pulse** — information radiator at `/pulse`. Signal tiles show agent output as live widgets. 9 display templates (metric, text-headline, table, status, time-series, image, text-image, media). Container layout with drag-and-drop reorder, edit mode, widget palette with auto-theming. System metric tiles replace the health strip. Markdown rendering, YouTube media player, tile collapse/expand.
- **Build from goal** — describe what you want in plain language, the builder designs a complete agent YAML with nodes, tools, inputs, and a Pulse signal block.
- **Agents** — card grid with filtering (status, source, search), sorting, pagination. 5-tab detail page: Overview (DAG viz, stats), Nodes (edit/delete/add), Config (LLM defaults, variables, secrets, status), Runs (history), YAML (editor).
- **Suggest improvements** — AI-powered agent review with "Apply now" one-click save. Auto-fixes shell template mistakes. Available from failed run pages with the error pre-filled.
- **LLM defaults** — agent-level provider (Claude/Codex) and model selection. Nodes inherit unless they override.
- **Tools** — browse built-in + user tools with filtering and pagination
- **Runs** — filter by agent/status, paginate, replay from any node, resolved variables panel, real-time turn progress for LLM nodes
- **Settings** — secrets CRUD with passphrase unlock, global variables, MCP token rotation
- **Tutorial** — 7-step guided walkthrough that scaffolds agents from the dashboard

## Flow control

Agents support first-class flow control nodes:

```yaml
nodes:
  - id: fetch
    type: shell
    command: echo '{"status": 200, "data": "ok"}'

  - id: check
    type: conditional
    dependsOn: [fetch]
    conditionalConfig:
      predicate: { field: status, equals: 200 }

  - id: process
    type: shell
    command: echo "Processing..."
    dependsOn: [check]
    onlyIf: { upstream: check, field: matched, equals: true }

  - id: fallback
    type: shell
    command: echo "Fetch failed"
    dependsOn: [check]
    onlyIf: { upstream: check, field: matched, notEquals: true }
```

Available node types: `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break`.

## Security

- **Secrets encrypted at rest** — AES-256-GCM with scrypt KDF (OWASP 2024 params)
- **3-layer redaction in run logs** — declared secrets, sensitive name patterns (TOKEN, KEY, PASS), known credential value patterns (GitHub PATs, AWS keys, JWTs)
- **Path traversal protection** — file-read/file-write tools validate paths stay within the working directory
- **Env-var injection deny-list** — agent inputs cannot override LD_PRELOAD, PATH, NODE_OPTIONS, or 25+ other sensitive env vars
- **MCP binds localhost** — bearer token auth, loopback-only by default, timing-safe token comparison
- **Community shell gate** — community agents require explicit `--allow-untrusted-shell`
- **Dashboard auth** — 3-layer (Host + Origin + cookie), HttpOnly SameSite=Strict cookies, 8-hour expiry
- **CI/CD** — SHA-pinned GitHub Actions, npm Trusted Publishing via OIDC (no static NPM_TOKEN)
- **Example agents vetted** — CI security check + execution test on every PR

Full model: [docs/SECURITY.md](docs/SECURITY.md)

## Packages

| Package | Description |
|---|---|
| `@some-useful-agents/core` | Types, schemas, stores, executor, tools, secrets |
| `@some-useful-agents/cli` | CLI commands, tutorial, scaffolding |
| `@some-useful-agents/dashboard` | Web dashboard (Express, server-rendered HTML) |
| `@some-useful-agents/mcp-server` | MCP server (HTTP/SSE transport) |
| `@some-useful-agents/temporal-provider` | Temporal worker for durable workflows |

## Requirements

- Node.js >= 22.5.0
- macOS or Linux (Windows untested)
- Docker (optional, for Temporal)

## License

MIT
