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

## Planned expansion (v0.16.0 — `structured-outputs-v0.16.md`)

The v0.16 release replaces "stdout is a string" with **structured, declared outputs per node**. Shape under discussion:

```yaml
- id: fetch
  type: shell
  command: curl -s https://api.example.com/items
  outputs:
    status:    { type: number, from: exit_code }
    body:      { type: json,   from: stdout }
    duration_ms: { type: number, from: runtime }
```

Template syntax becomes path-based and validated:

```
{{upstream.fetch.body.items[0].title}}   # traverses the JSON-typed output
{{upstream.fetch.status}}                # declared scalar
{{upstream.fetch.exit_code}}             # built-in per-node scalar
{{upstream.fetch.duration_ms}}           # built-in per-node scalar
```

Standard execution vocabulary available to every node (reserved namespace):

```
{{run.id}}, {{run.agent}}, {{run.triggered_by}}
{{node.id}}, {{node.attempt}}
{{now}}, {{date}}
{{upstream.<id>.stderr}}, {{upstream.<id>.exit_code}}, {{upstream.<id>.duration_ms}}
```

Backwards compatibility: `{{upstream.<id>.result}}` stays as a synonym for "full stdout as string" so existing agents keep working.

Plus: AI-assisted template authoring ("Suggest with Claude", "Write with Codex") on the dashboard forms — the editor already knows each upstream's declared outputs, so the AI gets real context.
