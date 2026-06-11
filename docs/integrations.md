# Integrations

An **integration** is a saved, reusable connection to an outside system — a Slack
webhook, an HTTPS endpoint, a local file, a database, or a tool on an MCP server.
Configure it once under **Settings → Integrations**, then reference it by id from
agents instead of repeating connection details (and secrets) on every agent.

Integrations come in two flavours:

- **Notify destinations** (`slack`, `webhook`, `file`, `mcp-tool`) — where an agent
  sends a message when a run finishes. Referenced from an agent's `notify` block.
- **Data sources** (`csv`, `postgres`, `sqlite`) — connect a dataset and sua
  **auto-generates query tools** that any node can call like a built-in.

This page is the user surface. Manage everything at
[`/settings/integrations`](http://127.0.0.1:3000/settings/integrations).

## Mental model

| Concept | What it is | Where it lives |
|---|---|---|
| **Integration** | A saved connection with kind-specific config + secret references | `integrations` table in the runtime DB |
| **Id** | `user:<name>` for ones you create; `<packId>:<name>` for pack-owned (read-only until the pack is uninstalled) | the `id` column |
| **Generated tool** | For data-source kinds, a tool row synthesized from the integration's schema | `tools` table |

Config never stores raw credentials — sensitive values are kept in the encrypted
[secrets store](SECURITY.md) and referenced by name (e.g. `webhook_secret`,
`url_secret`), then resolved at fire time.

## Kinds

| Kind | Purpose | Key config | Generates tools |
|---|---|---|---|
| `slack` | Slack incoming webhook | `webhook_secret`, optional `channel`, `mention` | — |
| `webhook` | Generic HTTPS POST/PUT | `url`, `method`, optional `headers_secret` | — |
| `file` | Append/overwrite a local file (JSONL when appending) | `path`, `append` | — |
| `mcp-tool` | Alias for one tool on a connected MCP server | `server_id`, `tool_name`, optional `default_inputs` | — |
| `csv` | Query a CSV file | `path`, `has_header`, `delimiter` | yes |
| `postgres` | Query a Postgres database | `url_secret` (DSN secret, default `DATABASE_URL`), `schemas` | yes |
| `sqlite` | Query a SQLite database file | `path` | yes |
| `apple` | macOS Reminders & Notes (experimental) | none (discovered at add-time) | yes |

For the data-source kinds, sua introspects the schema when you save the
integration and stores a snapshot, so the generated tools know the available
columns/tables without reconnecting on every run.

## Data-source tools

Saving a `csv` / `postgres` / `sqlite` integration creates read-only query tools.
The id pattern uses the integration's **slug** (its id with the `user:` / `<packId>:`
prefix stripped — `user:customers` → `customers`):

| Kind | Generated tool ids |
|---|---|
| `csv` | `csv.<slug>.read`, `csv.<slug>.count` |
| `postgres` | `postgres.<slug>.<table>.find`, `…find-one`, `…count` (a `<schema>.` segment is inserted for non-`public` schemas) |
| `sqlite` | `sqlite.<slug>.<table>.find`, `…find-one`, `…count` |
| `apple` | `apple.<slug>.reminder-create`, `…reminder-read`, `…reminder-update`, `…note-create`, `…note-read` |

## Apple (Reminders & Notes) — experimental, macOS-only

Lets agents create/read reminders and create/read notes on the owner's Mac. It
compiles a tiny Swift runner on demand (cached at `~/.sua/runners/apple_reminders`)
that talks to **EventKit** for Reminders and drives **Notes.app via AppleScript**
for Notes. Unlike the read-only data-source kinds, this kind exposes
**side-effecting write tools** — `reminder-create`, `reminder-update`, and
`note-create` change your real data.

**Enable it** (off by default — the engine ships dormant):

```jsonc
// sua.config.json
{ "experimental": { "apple": true } }
```

or `export SUA_EXPERIMENTAL_APPLE=1`. The dashboard **Apple** tab and the
`apple.*` tools stay hidden/unresolved until this is on.

**Authorize macOS access** once, from a Terminal (not the daemon — a headless
prompt is silently denied):

```bash
sua apple authorize
```

This triggers the **Reminders** permission prompt (EventKit) and the
**Automation → Notes** prompt (AppleScript) so you can click Allow. The prompts
attribute to whatever launched the process, not to "sua".

**Add the integration** in Settings → Integrations → Apple. sua introspects your
authorized reminder lists and note folders and stores them as the snapshot.
**Adding the integration is the authorization gesture** — it's what grants agents
the ability to create/read your reminders and notes. No secret to manage; nothing
personal is stored outside your local `data/runs.db`.

From the dashboard you can also click **Check access** (probes both permission
buckets with zero-content reads and shows granted/denied) and **Open Terminal &
authorize** (launches a Terminal running `sua apple authorize` for you).

### The TCC + daemon gotcha (important)

macOS ties the **Reminders** grant to the *responsible process tree*. When you
run `sua apple authorize` in Terminal, the grant attaches to **Terminal.app** —
**not** to sua's background daemons. So a detached process (the dashboard, and
the **temporal worker** that executes agent nodes) can report **denied** even
after you authorized in a Terminal, and it can't show its own prompt. (Notes /
Automation grants are broader and usually carry over.)

What this means for actually running the tools:

- **Reliable today:** run from a Terminal with the local provider, where the node
  executes in Terminal's (granted) process tree:
  `SUA_PROVIDER=local sua workflow run apple-reminder-demo`.
- **For temporal / scheduled runs:** the worker daemon needs the grant too. Start
  the worker in a **foreground Terminal** (`sua worker start`, not the detached
  daemon) so it inherits Terminal's grant. The dashboard **Check access** button
  reflects the daemon's state, so use it to confirm.
- A durable fix (code-signing the runner with a stable identity + entitlements so
  TCC keys on the binary) is out of scope for this experimental version.

**Other caveats.** Reminders is solid (EventKit). **Notes is best-effort**: no
first-party API, so AppleScript — `note-create` works but returns no reliable id,
and `note-read` is slow and capped (default 20). Off macOS, or without Xcode
Command Line Tools (`xcrun`), the tools fail with a clear "macOS-only" error.

Common shapes:

- **find / read** — inputs: `where` (an object whose keys are AND-ed equality
  filters), `limit`, and (Postgres/SQLite) `order_by`. Outputs: `rows` (array) +
  `row_count`.
- **find-one** — inputs: `where`, `order_by`. Output: `row` (a single object or
  null).
- **count** — input: `where`. Output: `count`.

### Using a generated tool in a node

Reference the generated tool id like any other tool:

```yaml
nodes:
  - id: fetch-churned
    type: shell
    tool: sqlite.metrics.events.find
    toolInputs:
      where: { event_type: "churn" }
      limit: 50

  - id: summarize
    type: llm-prompt
    dependsOn: [fetch-churned]
    prompt: |
      Summarize this week's churn events:
      {{upstream.fetch-churned.rows}}
```

The bundled `churn-watcher` example chains a SQLite integration →
`llm-prompt` → metric widget end to end.

> **Save-time validation.** When you save an agent that references generated-tool
> output (e.g. `{{upstream.fetch-churned.rows.0.email}}`), sua checks the path
> against the upstream tool's declared output schema and rejects references to
> columns that don't exist. `{{upstream.<id>.result}}` is always valid; lenient
> or unknown schemas are accepted rather than producing false positives.

## Notify destinations

`notify` is a top-level agent field. Each handler can name an integration with
`integration:`; inline fields override the integration's stored config, so you
can share a connection but tweak per-agent details:

```yaml
notify:
  on: [failure]                 # failure | success | always
  handlers:
    - type: slack
      integration: user:oncall  # pulls webhook_secret + channel from the saved integration
      mention: "@me"            # inline override

    - type: mcp-tool
      integration: user:gmail   # required for mcp-tool handlers
      inputs:
        to: alerts@example.com
        subject: "Run {{run.status}}"
        body: "Run {{run.id}} failed: {{run.error}}"
```

A broken handler is logged and skipped — it never fails the run. Handler/integration
kind mismatches are rejected (a `slack` handler can't point at a `webhook`
integration).

### Gmail and other MCP-backed services

The `mcp-tool` kind doesn't hold its own credentials — it points at a tool on a
server you've already connected under [Settings → MCP Servers](mcp.md). Gmail, for
example, is set up by connecting its MCP server (which owns the OAuth), then
creating an `mcp-tool` integration that selects the send tool and optional
`default_inputs`. Templating available in `default_inputs` at fire time:
`{{vars.X}}`, `{{agent.id}}`, `{{agent.name}}`, `{{run.id}}`, `{{run.status}}`,
`{{run.error}}`.

## Managing integrations

At [`/settings/integrations`](http://127.0.0.1:3000/settings/integrations), a tab
strip (All / Slack / Webhook / File / MCP Tool / CSV / Postgres / SQLite) shows
each kind with an inline add form. Creating or editing a data-source integration
re-introspects and refreshes its schema snapshot (and its generated tools).
Delete removes a `user:` integration; pack-owned integrations are read-only —
uninstall the pack to remove them.

## Related

- [Tools](tools.md) — how tools (including generated ones) are referenced and run
- [MCP servers](mcp.md) — connect servers that back `mcp-tool` integrations
- [Agents reference](agents.md) — the `notify` block and node `tool` / `toolInputs`
- [Security model](SECURITY.md) — secret storage and resolution at fire time
