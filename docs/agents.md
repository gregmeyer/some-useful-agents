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

tags:                         # optional routing — domain nouns, scored like entryConditions
  - weather
  - forecast
entryConditions:              # optional routing — when this agent SHOULD handle a request
  - user asks for today's weather
nonEntryConditions:           # optional routing — when it should NOT (disambiguation)
  - user asks about historical climate
sampleQuestions:              # optional routing — representative questions it answers
  - What's the weather in Denver tomorrow?

provider: claude              # optional agent-level LLM default (claude | codex)
model: claude-sonnet-4-5      # optional agent-level model default

inputs:                       # optional — runtime values users can supply
  TOPIC: { type: string, required: true }

schedule: "0 9 * * *"         # optional cron — daily at 9am
allowHighFrequency: false     # optional — permit sub-minute cron cadences (default: false)
timeoutSec: 60                # optional — wall-clock ceiling for the entire DAG run
envAllowlist: [PATH, HOME]    # optional — override the default shell env allowlist
secrets: [API_KEY]            # optional — secrets this agent's nodes can reference
redactSecrets: true           # optional — redact matched-prefix credentials in run logs
pulseVisible: true            # optional — show this agent's tile on the home board (/)

permissions:                  # optional — per-agent CSP allowances for widget rendering
  imgSrc: ["https://images.example.com"]

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

> **Defaults are literal, not references.** An input `default:` is a plain string — it is **not** re-resolved against secrets or variables. Writing `default: $API_KEY` injects the literal seven characters `$API_KEY` (a bogus credential) and, because input values out-rank secrets/variables in [env precedence](#secrets-and-envallowlist), it silently shadows a real `API_KEY`. The schema **rejects** any default matching `^$NAME$`. To use a secret, declare it with [`secrets:`](#secrets-and-envallowlist) and reference `$NAME` in the command (or `{{secrets.NAME}}` in a prompt); for a non-secret, set a [global variable](templating.md#global-variables) and reference `$NAME` / `{{vars.NAME}}` — in both cases with **no input default**.

## Persistent state — `$STATE_DIR` and `{{state}}`

Agents that need to persist data across runs (diff-over-time, caches, last-fired markers) get a per-agent directory at `data/agent-state/<agent-id>/`. Created lazily on first use, chmod 0o700, removed automatically when the agent is deleted.

Available as:
- **`$STATE_DIR`** env var in shell nodes (and as a top-level template variable in built-in tool inputs)
- **`{{state}}`** template token in llm-prompt prompts and built-in tool inputs (e.g. `file-write`'s `path:`)

Example — README change watcher:

```yaml
nodes:
  - id: fetch
    type: shell
    command: |
      curl -sf "https://api.github.com/repos/$REPO/readme" | jq -r '.content' | base64 -d
  - id: diff
    type: shell
    dependsOn: [fetch]
    command: |
      mkdir -p "$STATE_DIR"
      PREV="$STATE_DIR/last-readme.md"
      NEW="$STATE_DIR/current-readme.md"
      echo "$UPSTREAM_FETCH_RESULT" > "$NEW"
      if [ -f "$PREV" ]; then
        if ! diff -q "$PREV" "$NEW" > /dev/null; then
          echo '{"changed":true,"diff":"'"$(diff "$PREV" "$NEW" | head -20 | base64)"'"}'
        else
          echo '{"changed":false}'
        fi
      else
        echo '{"changed":false,"first_run":true}'
      fi
      cp "$NEW" "$PREV"
```

State is **not** swept by run retention — it persists until the agent is deleted. Don't put secrets in there; the dir lives on disk in plain text.

Currently available to: dashboard runs, `sua workflow run`, `sua workflow replay`. **Not yet available** to scheduled agents going through `sua schedule start` (uses the v1 chain executor; will be wired in a follow-up).

### Per-agent size cap

To prevent a runaway agent from filling your disk (e.g. an agent that appends to a log file every run, forever), the executor enforces a per-agent cap on state-dir bytes-on-disk. Default is **100 MB**. Override per-agent:

```yaml
id: my-cache-agent
stateMaxBytes: 1073741824   # 1 GB cap for an agent that legitimately stores a lot
```

Set to `0` to disable the cap entirely (use sparingly).

The cap is checked **before each node runs**. If the dir already exceeds the cap (typically because a previous run grew it), the next node fails with category `setup` and a clear error pointing to `sua state prune <agent>`. The node that *exceeded* the cap completes; the *next* node is the one that fails. This attributes the error cleanly to a fresh node rather than retroactively failing a node that already finished.

### `sua state` CLI

Operational hygiene for state directories:

| Command | What it does |
|---|---|
| `sua state list` | Every agent with a state dir, sorted by size, with a total |
| `sua state du <agent>` | Per-file/dir breakdown inside one agent's state |
| `sua state prune <agent>` | Clear the contents (keeps the empty dir). Add `--remove` to delete the dir entirely. Add `-y` to skip the confirmation. |
| `sua state export <agent> [path]` | `tar.gz` the dir to a path (or stdout when omitted). For backup or migration. |

### Audit trail

Each node execution captures `stateBytesBefore` and `stateBytesAfter` when the agent has a state dir configured. The dashboard run-detail page surfaces the delta as a small badge (`state +12 KB` / `state −500 KB`) on each node, only when the value changed. Useful for spotting the node that's growing your state unexpectedly.

## `outputs`

Author-declared shape of the agent's final-node JSON result. Optional but recommended — used by the planner for cross-agent composition (`agent-invoke` chaining) and by the widget editor for field-name suggestions.

```yaml
outputs:
  articles:
    type: array
    description: List of stories with title, url, score
  count:
    type: number
  date:
    type: string
    description: ISO date the digest was built
```

Names use `lowercase_snake_case` (matches the JSON convention; unlike `inputs:` which are UPPERCASE because they become env vars). Types: `string`, `number`, `boolean`, `object`, `array`.

**Documentation, not a contract.** Declaring `outputs.foo` doesn't make the executor verify the JSON contains `foo`. Treat it as machine-readable docs: the planner reads it when chaining your agent into another agent's `agent-invoke` node, and the Output Widget editor uses it to suggest `name:` field values.

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
| `llm-prompt` | Run a Claude / Codex prompt | `prompt`, `model`, `maxTurns`, `allowedTools`, `provider` |
| `conditional` | Branch based on a predicate | `conditionalConfig` |
| `switch` | Multi-way branch | `switchConfig` |
| `loop` | Iterate over a list or sub-agent invocations | `loopConfig` |
| `agent-invoke` | Call another agent as a sub-workflow | `agentInvokeConfig` |
| `branch` / `end` / `break` | Flow control primitives | (see [flows.md](flows.md)) |

Full flow control reference: [flows.md](flows.md).

> **Alias:** `type: claude-code` is the legacy spelling of `type: llm-prompt`. Both load identically and dispatch through the same code path; the CLI binary is chosen by the `provider:` field (`claude` or `codex`). New agents should use `llm-prompt`; existing agents continue to work unchanged.

### `shell` and `llm-prompt` with tools

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

Optional Pulse tile config. When set, the agent's most recent run renders on the home board (`/`).

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

A minimum-frequency cap is enforced to prevent runaway loops — see [ADR-0012](adr/0012-local-cron-scheduler-node-cron.md). Expressions finer than once a minute are rejected unless the agent opts in with `allowHighFrequency: true`. The dashboard's Schedule card validates the same rules server-side.

## Timeouts

Two layers protect a run from burning unbounded time / tokens:

| Layer | Field | Default | Where it lives | What it does |
|---|---|---|---|---|
| Per-node | `nodes[*].timeout:` | 300s | each node | Soft cap for a single node. If the child process is still running at the deadline, `spawnProcess` sends SIGTERM, then SIGKILL after 5s if the child hasn't exited. The node ends with `exitCode=124` and `errorCategory='timeout'`; downstream nodes still run. |
| Agent-level | `timeoutSec:` (top level) | unset | this file | Hard wall-clock ceiling for the entire DAG run. Catches the "10-node DAG legitimately runs 10 minutes" case that no single per-node `timeout:` can see. |

When `timeoutSec` trips, the executor's internal `AbortController` fires, the in-flight node's spawn receives the same SIGTERM-then-SIGKILL escalation as per-node timeout, every remaining not-yet-started node is written as `cancelled` (category `cancelled`, not `timeout`), and the run's `error` field names the cap directly: `Agent wall-clock timeout (60s) exceeded.` Set `timeoutSec: 0` (or omit) to disable.

Recommended sizing: pick something like 2–3× the agent's expected runtime. The bundled `layout-planner` ships with `timeoutSec: 60` against a normal runtime of ~20s — generous enough not to flag slow happy-path runs, tight enough to catch the orphaned-CLI burning tokens case.

**Orphan reaper relationship.** Both timeout layers live as in-process timers — if the dashboard itself dies mid-run (`daemon restart`, crash, OOM), they die with it. A separate on-boot reaper handles that case by reading `runs.status IN ('running','pending')`, persisting `childPid` + `childStartedAtMs` on `node_executions`, and SIGKILL'ing the orphan after a `ps`-based start-time cross-check. See [Security model § Orphan process reaper](SECURITY.md).

## `pulseVisible`

Whether this agent's `signal` tile appears on the home board (`/`) (default: `true` for agents that declare a `signal`). The `×` button on a Pulse tile toggles this flag; "Hide all" / "Show all" bulk-toggle it. Named dashboards (`/dashboards/:id`) curate their own tile lists independently of `pulseVisible`.

## Routing metadata — `tags`, `entryConditions`, `nonEntryConditions`, `sampleQuestions`

Optional lists of short natural-language strings that describe *when* an agent should be picked, so routers reach the right agent instead of guessing from the `description` alone:

- **`tags`** — 3–6 lowercase domain nouns. Cheapest field to add and weighted the same as the others.
- **`entryConditions`** — situations this agent is for. A request matching one is strong evidence this is the agent to run.
- **`nonEntryConditions`** — look-alike situations it is explicitly *not* for. Used to disambiguate from sibling agents.
- **`sampleQuestions`** — representative questions a user would ask that this agent answers.

They are read by four routers: the **`/agents` search box** (relevance ranking), the **inbox triage** ranker + LLM, the **build-from-goal surveyor** (to reuse an existing agent instead of drafting a duplicate), and the **MCP `list-agents`** payload (so external clients like Claude Desktop route on them). The build-from-goal drafter populates these for new agents; edit them any time on the agent's YAML tab. All are versioned with the rest of the agent definition.

### How they are scored

The deterministic ranker (`catalogRelevance` in `@some-useful-agents/core`) tokenizes the request — dropping stopwords and anything under 3 characters — and then, per token:

| Field | Weight |
| --- | --- |
| `id`, `name`, `tags`, `entryConditions`, `sampleQuestions` | **+3** |
| `description` | **+1** |
| `nonEntryConditions` | **0** (never scored) |

Strong and weak do not stack, and each token scores at most once. `nonEntryConditions` is deliberately unscored: it is an LLM-applied veto, never a deterministic filter, so a matching "not for" phrase can't quietly drop an agent before the LLM sees it.

### Writing them well

Guidance below comes from measuring a labeled set of newcomer phrasings against the shipped catalog (`routing-eval-catalog.test.ts`); each rule is one that measurably moved top-1 accuracy:

- **Avoid generic filler in scored fields.** Matching is *substring*, not word-boundary, so a throwaway "right now" in an `entryCondition` will win the token `right` against every unrelated request. Filler in a +3 field actively steals traffic from the agent that deserves it.
- **Don't echo the `id` or `name` in a `sampleQuestion`.** Those already score +3; repeating them adds no signal and spends a question slot.
- **Cross-reference siblings by id in `nonEntryConditions`** ("not for a persistent tile — use `weather-dashboard`"). Unscored, so it costs nothing deterministically and is what the triage LLM uses to break ties within a family.
- **Put the vocabulary a whole family shares in `tags`, and the vocabulary that separates them in `entryConditions`/`sampleQuestions`.** This is what keeps the reuse-hint margin intact: clustered agents rise together on shared words, and only the discriminating words break the tie.

Non-exempt agents under `agents/examples/` are held to a minimum by `agent-metadata-coverage.test.ts`, which also rejects duplicated sample questions and over-broad tags.

## `permissions`

Per-agent allowances that widen what the agent's output widget may do under the dashboard's Content-Security-Policy. Today this carries `imgSrc` — the external image hosts an `ai-template` widget is allowed to load `<img>` from. When a widget references a blocked host, the tile shows a one-click "allow" modal that appends the host here. See [Output widgets → Security](output-widgets.md#security).

## `secrets` and `envAllowlist`

Controls what environment the shell and llm-prompt subprocesses see. By default the executor filters to a safe allowlist. Per-agent (or per-node) additions merge in.

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

> **Trust:** MCP callers carry the same authority as the bearer-token holder. A shell agent that interpolates raw inputs into its command string with `{{inputs.X}}` (or env-var expansion without quoting) is exposing a code-execution path to anyone with the token. Quote inputs at substitution time, prefer `llm-prompt` agents over `shell` for free-form text inputs, and rotate the token under [Settings → General](http://127.0.0.1:3000/settings/general) if you suspect compromise.

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
    type: llm-prompt
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
- [Pattern: SQLite log + table widget](patterns/sqlite-log-widget.md) — a writer + reader agent pair over a shared SQLite store
- [Success criteria + agent loop](success-criteria.md) — author-declared eval gate, re-runs on failure
- [Outcome detection](outcome-detection.md) — evidence-backed records of what resulted from a run
- [Retry policy](retry.md) — transient-failure backoff (separate from success criteria)
- [Security model](SECURITY.md) — trust rings, shell gate, env filter
