# Templating reference

This page defines the template variables sua substitutes into node commands and prompts at run time.

- Agents declare nodes; nodes declare dependencies.
- At run time, each node's body is substituted with values from **agent inputs** (supplied at `sua workflow run --input`) and **upstream node outputs** (the stdout of each `dependsOn` node).
- Two syntaxes coexist: **`{{handlebars}}`** for claude-code prompts, **`$ENV_VARS`** for shell commands.

## Agent-level inputs

Passed to `sua workflow run <agent> --input KEY=value`.

| Node type | Syntax | Example |
|---|---|---|
| `claude-code` | `{{inputs.KEY}}` | `Summarise the {{inputs.TOPIC}} headlines.` |
| `shell` | `$KEY` (as regular env var) | `curl -s "$BASE_URL/items"` |

Every `{{inputs.X}}` reference must match a declared input on the agent — typos fail the schema at save time.

## Upstream node outputs

Every node in the current node's `dependsOn` list exposes its stdout under `upstream.<id>`.

| Node type | Syntax | Example |
|---|---|---|
| `claude-code` | `{{upstream.<nodeId>.result}}` | `Summarise: {{upstream.fetch.result}}` |
| `shell` | `$UPSTREAM_<NODEID>_RESULT` (uppercase, hyphens → underscores) | `echo "got: $UPSTREAM_FETCH_RESULT"` |

Notes:

- `upstream` is a **reserved keyword**, not a placeholder for an agent name.
- `<nodeId>` is the upstream **node's id**, scoped to the same agent.
- `.result` is the **full stdout as a single string**. No sub-paths today — for structured access, emit JSON and parse it downstream (`echo "$UPSTREAM_FETCH_RESULT" | jq .count`).
- A node can only reference upstreams it declares in `dependsOn`. Unknown references fail the schema.

## What the executor guarantees today

For every node, the runtime provides:

- **Shell nodes:** `$UPSTREAM_<ID>_RESULT` per declared upstream + `$<INPUT_NAME>` per declared agent input. The rest of the env is filtered to the `envAllowlist` plus the node's explicit `env:` + `secrets:` lists.
- **Claude-code nodes:** `{{inputs.X}}` and `{{upstream.X.result}}` interpolated in the prompt before the call. `allowedTools` gates which tools Claude can invoke.

## Execution vocabulary — current surface

What's available today:

```
{{inputs.<NAME>}}              # agent-level runtime input (claude-code)
$<NAME>                        # same, as env var (shell)
{{upstream.<nodeId>.result}}   # upstream stdout (claude-code)
$UPSTREAM_<NODEID>_RESULT      # same, as env var (shell)
```

That's it. Everything else the executor knows is not yet addressable from a template.

## Global variables

Non-sensitive, project-wide values. Set via `/settings/variables` or `sua vars set NAME value`.

| Node type | Syntax | Example |
|---|---|---|
| `claude-code` | `{{vars.NAME}}` | `Publish to {{vars.SLACK_CHANNEL}}` |
| `shell` | `$NAME` (same as inputs — env var) | `echo "deploying to $DEPLOY_ENV"` |

Variables lose to agent inputs with the same name, so agents can selectively override.

## Tool-declared outputs

A user tool can declare typed outputs in its YAML; the runtime extracts them from the tool's result. See [Tool reference](tools.md) for the schema.

Downstream nodes reach those fields via the same `{{upstream.<id>.<field>}}` shape. Example — the `csv-to-chart-json` builtin emits `data_json`, `labels`, `values`, `series`, `cohorts`:

```yaml
- id: parse
  tool: csv-to-chart-json
  toolInputs:
    csv: "{{inputs.CSV_TEXT}}"
    shape: simple

- id: chart
  tool: modern-graphics-generate-graphic
  dependsOn: [parse]
  toolInputs:
    layout: bar-chart
    data: "{{upstream.parse.result}}"     # the stringified JSON
```

For shell downstream nodes, each declared output is exported as `$UPSTREAM_<NODEID>_<FIELD>`.

## Output widget placeholders

Output widgets use the **same extractor** (XML tag or JSON key) but a different template syntax — `{{outputs.NAME}}` and `{{result}}`. See [Output widgets](output-widgets.md) for the full reference.

Run output is extracted first, HTML-escaped, then substituted into the (sanitized) template. The AI-generated `ai-template` widget is the primary consumer.

## Quick reference

```
{{inputs.<NAME>}}              # agent-level runtime input (claude-code)
$<NAME>                        # same, as env var (shell)
{{vars.<NAME>}}                # global variable (claude-code)
$<NAME>                        # same — inputs win if the name collides (shell)
{{upstream.<nodeId>.result}}   # upstream stdout (claude-code)
$UPSTREAM_<NODEID>_RESULT      # same, as env var (shell)
{{outputs.<NAME>}}             # output widget placeholder (ai-template widgets only)
{{result}}                     # raw run output (ai-template widgets only)
```

## Related

- [Agents reference](agents.md) — declaring `inputs:` on an agent
- [Tools reference](tools.md) — declaring `outputs:` on a tool
- [Output widgets](output-widgets.md) — `{{outputs.*}}` and the AI template flow
