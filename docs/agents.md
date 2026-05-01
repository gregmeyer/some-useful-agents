# Agent YAML reference

An agent is a named DAG of nodes. This page documents every field an agent YAML can declare.

The runtime source of truth is the `agents` table in `data/runs.db`. YAML is the lossless import/export format — `sua workflow import-yaml <file>` and `sua workflow export <id>` round-trip.

## Top-level structure

```yaml
id: my-agent                  # required, lowercase + hyphens
name: My Agent                # required, display name
description: What it does     # optional
status: active                # active | paused | archived | draft (default: draft)
source: local                 # local | examples | community (default: local)
version: 1                    # auto-managed by the store
mcp: false                    # whether to expose via the MCP server (default: false)

provider: claude              # optional agent-level LLM default (claude | codex)
model: claude-sonnet-4-5      # optional agent-level model default

inputs:                       # optional — runtime values users can supply
  TOPIC: { type: string, required: true }

schedule: "0 9 * * *"         # optional cron — daily at 9am
envAllowlist: [PATH, HOME]    # optional — override the default shell env allowlist
secrets: [API_KEY]            # optional — secrets this agent's nodes can reference
redactSecrets: true           # optional — redact matched-prefix credentials in run logs

signal:                       # optional — Pulse tile config
  title: "Today's data"
  template: metric
  mapping: { value: count }
  size: 2x1

outputWidget:                 # optional — how run output renders on /agents/:id
  type: dashboard
  fields: [ ... ]

nodes:                        # required — minimum one
  - id: main
    type: shell
    command: echo hi
```

## `inputs`

Runtime values supplied via `sua workflow run -i NAME=value` or the dashboard Run form. Each entry:

```yaml
inputs:
  TOPIC:
    type: string              # string | number | boolean | enum
    required: true            # default: false
    default: "defaults here"  # used when required is false and no value supplied
    description: "What the user is asked for"

  SEVERITY:
    type: enum
    required: false
    default: "low"
    values: [low, medium, high]   # enum requires non-empty values
    description: "Urgency tier"
```

Names must match `[A-Z_][A-Z0-9_]*` (uppercase letters, digits, underscores). The dashboard renders inputs in its Run modal: text fields for string/number, toggles for boolean, dropdowns for enum.

## `nodes`

Every agent has at least one node. Each node declares:

```yaml
- id: fetch                   # required, unique within the agent
  type: shell                 # required — see list below
  dependsOn: [upstream1, ...] # optional — defaults to no upstreams (root node)
  description: "What it does" # optional
```

### Node types

| Type | Purpose | Key fields |
|---|---|---|
| `shell` | Run a shell command | `command`, `tool`, `toolInputs` |
| `claude-code` | Run a Claude / Codex prompt | `prompt`, `model`, `maxTurns`, `allowedTools` |
| `conditional` | Branch based on a predicate | `conditionalConfig` |
| `switch` | Multi-way branch | `switchConfig` |
| `loop` | Iterate over a list or sub-agent invocations | `loopConfig` |
| `agent-invoke` | Call another agent as a sub-workflow | `agentInvokeConfig` |
| `branch` / `end` / `break` | Flow control primitives | (see [flows.md](flows.md)) |

Full flow control reference: [flows.md](flows.md).

### `shell` and `claude-code` with tools

Instead of an inline `command:` or `prompt:`, a node can reference a **tool** by id:

```yaml
- id: fetch
  type: shell
  tool: http-get
  toolInputs:
    url: "https://api.example.com/items"
    timeout: 10
```

See [Tools](tools.md) for the built-in list and [MCP servers](mcp.md) for importing external tools.

### Common optional fields

```yaml
- id: main
  type: shell
  command: echo hi
  env:                        # per-node env (overrides envAllowlist)
    NODE_ENV: production
  secrets: [API_KEY]          # per-node secret pass-through
  timeout: 120                # seconds, default 300
  workingDirectory: ./sub     # relative to project root
  onlyIf:                     # conditional edge from an upstream
    upstream: check
    field: matched
    equals: true
```

See [flows.md → onlyIf](flows.md#onlyif-edges) for the full predicate grammar.

## `signal`

Optional Pulse tile config. When set, the agent's most recent run renders on `/pulse`.

```yaml
signal:
  title: "Today's activity"
  icon: "📊"                   # any emoji or unicode glyph
  template: metric             # see below for full list
  mapping:                     # per-slot field → output-key mapping
    value: count
    label: "Runs today"
  format: number               # v1 compat — template wins if both set
  refresh: "5m"                # "5m" | "1h" — dashboard polls and rerenders
  size: 2x1                    # 1x1 | 2x1 | 1x2 | 2x2
  accent: teal                 # optional color accent
  hidden: false                # tile is hidden from main grid when true
```

**Templates:** `metric`, `time-series`, `text-headline`, `text-image`, `image`, `table`, `status`, `media`, `widget`, `comparison`, `key-value`, `story`, `funnel`.

`template: widget` is special — it mirrors the agent's own `outputWidget` rendering (see [Output widgets → Pulse integration](output-widgets.md#pulse-integration)). No mapping required.

## `outputWidget`

Declarative renderer for run output. Full reference: [output-widgets.md](output-widgets.md).

```yaml
outputWidget:
  type: dashboard              # raw | key-value | diff-apply | dashboard | ai-template
  fields:
    - { name: score, type: metric, label: "Score" }
    - { name: status, type: badge, label: "Status" }
    - { name: summary, type: text }
  actions:                     # diff-apply only
    - { id: apply, label: "Apply", method: POST, endpoint: "/agents/{agentId}/apply" }

  # ai-template only:
  prompt: "A card with score + status + sparkline"
  template: "<div>...{{outputs.score}}...</div>"
```

## `schedule`

Standard cron expressions, validated via `cron-parser`. The local cron runner picks up active + scheduled agents.

```yaml
schedule: "0 9 * * *"         # 9am daily
schedule: "*/15 * * * *"       # every 15 minutes
schedule: "0 18 * * 1-5"       # 6pm weekdays
```

A minimum-frequency cap is enforced to prevent runaway loops — see [ADR-0012](adr/0012-local-cron-scheduler-node-cron.md).

## `secrets` and `envAllowlist`

Controls what environment the shell and claude-code subprocesses see. By default the executor filters to a safe allowlist. Per-agent (or per-node) additions merge in.

```yaml
# Agent-level — every node in this agent sees these
secrets: [OPENAI_API_KEY, SLACK_WEBHOOK]
envAllowlist: [PATH, HOME, LANG]
redactSecrets: true

nodes:
  - id: call
    type: shell
    secrets: [EXTRA_TOKEN]    # node-level addition
    command: |
      curl -H "Authorization: Bearer $EXTRA_TOKEN" ...
```

Secrets come from the secrets store (`sua secrets set`). Global variables (plain-text, non-sensitive) are always available as `$NAME` / `{{vars.NAME}}` without listing — see [Templating](templating.md#global-variables).

## `mcp: true`

Opt the agent into MCP exposure. With `sua mcp start` running, Claude Desktop (or any MCP client with the bearer token) can invoke this agent via `run-agent`.

The `run-agent` tool accepts an optional `inputs` map for agents that declare an `inputs:` block:

```json
{
  "name": "graphics-creator-mcp",
  "inputs": { "TOPIC": "Q2 wins", "LAYOUT": "hero" }
}
```

Values are validated against each input's declared `type`, `required`, default, and (for enums) `values`. Undeclared keys are rejected. Per-value payloads are capped at 8 KB (64 KB total across all inputs) — the cap applies only to the MCP boundary, not to dashboard or CLI runs. Call `list-agents` to introspect each agent's `inputs` schema.

> **Trust:** MCP callers carry the same authority as the bearer-token holder. A shell agent that interpolates raw inputs into its command string with `{{inputs.X}}` (or env-var expansion without quoting) is exposing a code-execution path to anyone with the token. Quote inputs at substitution time, prefer `claude-code` agents over `shell` for free-form text inputs, and rotate the token under [Settings → General](http://127.0.0.1:3000/settings/general) if you suspect compromise.

See [MCP server (outbound)](../packages/mcp-server/README.md) for the connection details.

## Full worked example

```yaml
id: daily-joke
name: Daily Dad Joke
status: active
source: examples

schedule: "0 9 * * *"

signal:
  title: "Joke of the day"
  icon: "😂"
  template: text-headline
  mapping:
    headline: joke
  size: 2x1

nodes:
  - id: fetch
    type: shell
    tool: http-get
    toolInputs:
      url: "https://icanhazdadjoke.com/"
      headers: { Accept: "application/json" }

  - id: extract
    type: claude-code
    dependsOn: [fetch]
    prompt: |
      Extract the joke from this JSON response and return just the joke text:
      {{upstream.fetch.result}}
```

## Related

- [Quickstart](quickstart.md) — scaffolding + first agent
- [Flows](flows.md) — conditional, switch, loop, agent-invoke, branch
- [Tools](tools.md) — built-in + MCP + user-authored
- [Templating](templating.md) — placeholder reference
- [Output widgets](output-widgets.md) — render run output as UI
- [Security model](SECURITY.md) — trust rings, shell gate, env filter
