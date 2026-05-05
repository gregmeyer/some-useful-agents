# @some-useful-agents/dashboard

## 0.20.0

### Minor Changes

- 5c2e83f: agent-builder uses the manifest layer.

  Wires the manifest data shipped in PR A.5/A.6/A.7 into the existing `design → validate → fix` agent-builder DAG. Three changes:

  **Discovery catalog upgrade** — `buildDiscoveryCatalog` now sources node-types from the canonical `NODE_CATALOG` (PR A.7) instead of a hand-authored string, and includes per-agent `outputs:` (PR A.5) + `capabilities:` (PR A.6) in the AVAILABLE AGENTS section. New CRITICAL — OUTPUT WIDGET FIELD SCHEMA section calls out the most common bug (`name:` is the JSON key, not a label; do NOT use `source:`/`path:`/`from:`/`key:`). New DESIGN DISCIPLINE section enforces decomposition (3+ stages → 3+ nodes), `outputs:` declaration, and template-syntax rules.

  **Agent-builder prompt** — `agents/examples/agent-builder.yaml` adds explicit decomposition discipline, outputs declaration rules, widget field schema rules with concrete examples, and signal-template/title rules.

  **`autoFixYaml` extensions** — five new fixes for residual LLM mistakes the prompt doesn't always prevent:

  - Widget field `source:` / `path:` / `from:` / `key:` → `name:` (with smart name/label swap when name was treated as a label)
  - Invalid `signal.template` → fallback to `text-headline`
  - `signal.title` JSEP-style expression → strip to first quoted segment
  - `signal.mapping.*` non-string value (array/object) → `result`
  - `outputWidget.title` (invented field) → silently strip

  **Dogfood result**: rebuilt the same weather-agent prompt that produced 6 distinct bugs in the baseline. Improved version produces clean YAML with `outputs:` declared, multi-node decomposition, correct widget field names, plain-string signal title, and a smarter API choice (Open-Meteo + geocoding instead of wttr.in). 12 new tests for the autoFixYaml extensions.

- 0042d16: Derived agent capabilities at the parse boundary.

  New `deriveCapabilities(agent: Agent): AgentCapabilities` in core. Computes a static, best-effort summary of what an agent uses and does — populated by `parseAgent` and `agent-store.rowToAgent` and exposed on `Agent.capabilities`.

  ```ts
  {
    tools_used:        string[],   // shell-exec, claude-code, http-get, allowedTools entries…
    mcp_servers_used:  string[],   // extracted from mcp__server__tool naming
    side_effects:      ('sends_notifications' | 'writes_files' | 'posts_http')[],
    reads_external:    string[],   // URLs from toolInputs.url/endpoint, regex hits in command/prompt
  }
  ```

  Heuristic and conservative — an empty array means "couldn't statically prove," not "doesn't do X." Not a security boundary. Used by the planner-fronted agent-builder (PR A) for cross-agent composition decisions and by the upcoming preflight checks ("does this agent need MCP servers I haven't installed?"). Recomputed on every read; never persisted.

- 0a73abe: Author-declared agent outputs.

  New top-level `outputs:` field on agents — a typed map describing the shape the agent's final-node JSON result reliably contains. Mirrors `inputs:` but with `lowercase_snake_case` names (matches JSON convention) and types `string | number | boolean | object | array`. Optional but recommended.

  ```yaml
  outputs:
    articles:
      type: array
      description: List of stories with title, url, score
    count:
      type: number
  ```

  Documentation, not a runtime contract — the executor doesn't verify the JSON matches. Used by the planner-fronted agent-builder (PR A) for cross-agent composition via `agent-invoke`, and by the Output Widget editor for `name:` field suggestions. Three example agents (`llm-tells-a-joke`, `daily-joke`, `two-step-digest`) now declare `outputs:` as reference patterns.

- 0745598: ai-template iteration + per-agent visibility toggles.

  The ai-template widget now supports `{{#each outputs.X as item}}…{{/each}}` block iteration (with nested `{{item.field}}`, escaped `{{item.field}}` vs unescaped `{{{item.field}}}`, and `{{@index}}`) plus a `{{{outputs.X}}}` triple-brace unescaped variant. List-shaped agent outputs (HN feeds, GitHub PR digests, monitoring dashboards) can now render proper card layouts instead of HTML-escaped JSON blobs.

  Adds two new top-level agent fields — `pulseVisible` and `dashboardVisible` (both default true). Toggleable from a new Visibility card on the agent Config tab. `pulseVisible: false` hides a tile from /pulse even when a signal is declared (legacy `signal.hidden` still honored). `dashboardVisible: false` hides the agent from the /agents list view; it remains reachable via direct URL, MCP, scheduler, and the runs page.

- b2f5498: Auto-retry on transient failures (R2 of failed-runs-and-retry plan).

  Agents can declare a top-level `retry:` block. When a run fails with a configured `errorCategory`, the orchestrator sleeps with backoff and spawns a fresh attempt, linked back to the head of the chain via `retryOfRunId` (same shape as R1's manual retry).

  ```yaml
  retry:
    attempts: 3 # total tries including the first; default 1
    backoff: exponential # exponential (default) | linear | fixed
    delaySeconds: 30 # base; 30 → 60 → 120 for exponential
    categories: [timeout, spawn_failure] # default; conservative
  ```

  `cancelled`, `setup`, `input_resolution`, `condition_not_met`, `flow_ended` are NEVER retried regardless of policy — they're deterministic or user-driven.

  Implementation lives ABOVE the executor as a thin wrapper (`executeAgentWithRetry` in core/retry.ts). Callers — Run Now, manual retry, widget run, `sua workflow run` — switched from `executeAgentDag` to the wrapper. Replay route stays on the raw executor (replay is investigation, not auto-recovery). Agents without a `retry:` block fall through to a single executor call (zero overhead).

- 38f2da6: `file-write` first-class node type.

  A real schema gap surfaced by the dogfood: agent-builder kept reaching for `type: file-write` (a node type that didn't exist) instead of the longer `type: shell` + `tool: file-write` + `toolInputs: { path, content }` form. Promoting it to a first-class node type makes the LLM's intuition correct and keeps YAML readable.

  ```yaml
  - id: save
    type: file-write
    dependsOn: [build-summary]
    path: "output/digest-{{inputs.DATE}}.md"
    content: "{{upstream.build-summary.result}}"
    append: false # optional; default false
  ```

  Top-level `path:` and `content:` desugar to `tool: 'file-write'` + `toolInputs: { path, content, append }` at dispatch time — no executor branch added, just a small `resolveToolId`/`resolveToolInputs` extension. The existing `file-write` tool gained an `append:` mode (writes with `flag: 'a'`).

  Templating: built-in tool dispatch now resolves `{{upstream.X.field}}`, `{{vars.X}}`, and `{{inputs.X}}` in string-typed tool inputs, so `path:` and `content:` (and any other built-in tool's string fields) can reference upstream outputs and inputs. Previously only MCP tools had this.

  Schema enforces `path` + `content` are required when `type: file-write`, and validates that any `{{upstream.X.result}}` reference in `path` or `content` declares `X` in `dependsOn` (same rule as for shell/claude-code).

  Capabilities derivation (PR A.6) updated to recognize `type: file-write` as the `file-write` tool, so `tools_used` and `side_effects: ['writes_files']` populate correctly.

  Node catalog (PR A.7) gets a new entry with description, inputs, outputs, use-when guidance, and example. The forcing-function test ensures the new `NodeType` enum value has a catalog entry.

- 475f28d: Interactive widgets: form is always visible alongside the result.

  Magic-8-ball-style Pulse tiles now render the inputs form below the last result in idle, so re-running with a tweaked prompt is one edit + one click instead of two clicks through a separate "Ask again" pane. Form fields pre-fill with the most recent run's input values rather than the agent's declared defaults. The state machine collapses to idle / running / stuck / error.

- 96b1089: One-click manual retry on failed runs.

  Failed runs (`status: failed`) gain a Retry button on the run-detail page. Clicking it recovers the original agent-level inputs from the prior run, creates a fresh run with `attempt: N+1`, and links back to the head of the chain via the new `retryOfRunId` field. Distinct from Replay (which re-runs from a specific node reusing upstream outputs); Retry redoes the whole run from scratch — the right tool for transient failures. Run-detail header now shows an "attempt N" badge on any retry, plus a "Retry of" link back to the original.

  Schema additions: `runs.attempt INTEGER DEFAULT 1`, `runs.retry_of_run_id TEXT` (nullable). Migrations are additive — existing runs default to `attempt=1, retry_of_run_id=NULL`.

  Foundation for upcoming auto-retry (agent-declared `retry:` policy), notify deferral, and triage surfaces.

- bea09e7: Dashboard: control the outbound MCP server from `/settings/mcp`.

  A new Settings tab between Variables and MCP Servers shows the live state of the MCP server (the one Claude Desktop talks to): running/stopped status with PID, endpoint URL, bearer-token fingerprint with a link to rotate, list of `mcp: true` agents with run counts, and a pre-filled Claude Desktop config snippet you can copy directly into `claude_desktop_config.json`. Start and Stop buttons spawn or signal the MCP service via the same daemon supervisor `sua daemon start` uses, so the dashboard and the CLI agree on the PID file at `<dataDir>/daemon/mcp.pid`. The supervisor moved from the `cli` package to `core` so the dashboard can use it directly.

- 0f93483: mcp-server: `run-agent` accepts inputs.

  The MCP `run-agent` tool now takes an optional `inputs` map so MCP clients (Claude Desktop, Claude Code, Cursor) can run agents that declare an `inputs:` block, not only the input-less ones. Values are validated through the same path as dashboard / CLI / scheduler runs (type checks, enum membership, undeclared-key rejection, missing-required errors). Validation failures surface as MCP `isError: true` with the user-readable message instead of a generic 500.

  Two defensive caps live at the MCP boundary specifically: 8 KB per value, 64 KB total. Dashboard / CLI / scheduler are unaffected. The `list-agents` tool now also returns each agent's declared input schema (type, required, default, enum values) so callers can introspect what to pass.

  Known follow-up: shell agents that interpolate raw inputs into command strings via `{{inputs.X}}` (or unquoted env-var expansion) are vulnerable to injection regardless of trigger source. Tracked separately for a hardening pass at the substitution layer.

- 9bcce23: Node catalog API + dashboard page.

  Hand-authored typed contract for every first-class node type (`shell`, `claude-code`, `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break`). Each contract has a description, full inputs and outputs lists, "use when" guidance, and a copy-pasteable example.

  - `NODE_CATALOG` + `listNodeContracts()` + `getNodeContract()` exported from `@some-useful-agents/core`.
  - Dashboard routes: `GET /api/nodes` (full catalog as JSON), `GET /api/nodes/:type` (single entry), `GET /nodes` (browseable HTML page).
  - New "Nodes" entry in the top nav between Tools and Runs.

  The planner-fronted agent-builder (PR A) will query `/api/nodes` during its discover step so the LLM works from the actual node-type contract instead of guessing or inventing names like `file-write` or `template`. The page is also useful for humans browsing what's available.

  Forcing function: a test asserts every `NodeType` has a catalog entry — adding a new node type without documenting it fails the test.

- 29b524f: Notify deferral: one page per retry chain, not one per attempt (R3).

  When an agent has a `retry:` policy, `notify:` handlers now fire **once per chain** at the terminal outcome instead of once per attempt. A 3-attempt agent that recovers on attempt 2 produces one `success` notify and zero `failure` notifies. A run that exhausts its budget over three failed attempts produces one `failure` notify, not three.

  Mechanism: `executeAgentDag` accepts a new `suppressNotify` option that the orchestrator sets on every internal attempt. The wrapper fires notify itself after the chain settles. Agents without a `retry:` policy fall through to single-attempt mode and fire notify exactly as before — no behavior change.

  Builds on R1 (manual retry) + R2 (auto-retry policy). R4 (triage surface) and R5 (scheduler backoff) still to come.

- 647e172: Rescue analyzer/builder LLM mistakes in `outputs:` and ai-template widgets,
  and add truthy `{{#if outputs.X}}` to the template grammar.

  Three changes that close a "Fix with AI" loop where every suggestion failed
  validation with `outputs.X: Expected object, received string`:

  - **Discovery catalog** now shows the canonical `outputs:` syntax with
    examples of both shorthand (`count: number`) and full form, and explicitly
    flags the two common LLM mistakes (description in the type slot, camelCase
    keys). The previous one-liner said "declare the shape" without a single
    example, which invited free-text descriptions in the value slot.
  - **`autoFixYaml`** now coerces any string value in `outputs:` to
    `{ type: 'string', description: val }` (instead of leaving non-type strings
    alone) and snake_cases camelCase keys. Strings are the most permissive
    output type, so this is safe and unblocks the user.
  - **`/analyze/fix-yaml` retry prompt** now lists the outputs rules so a
    second LLM pass can actually fix the problem.
  - **ai-template `{{#if outputs.X}} … {{/if}}`** now supported as a truthy
    conditional (single-level, no `else`, no helpers). LLMs reach for this
    constantly when describing "show success card if found"; the workaround
    was always-render which produced broken UIs. Helpers like `(eq …)` and
    `{{else}}` deliberately remain unsupported — render two templates and
    switch via a field-toggle for branching.
  - **`autoFixYaml` Fix 6b** un-escapes `{ {` → `{{` (and `} }` → `}}`)
    inside `outputWidget.template`, mirroring the existing fix for
    claude-code prompts. Without this, the renderer printed escape
    sequences as literal text.
  - **Discovery catalog** documents the full ai-template grammar (including
    `#if` and `#unless`) and explicitly enumerates what's NOT supported, so
    the builder LLM stops reaching for `(eq …)` and `{{else}}`.
  - **`{{#unless outputs.X}}`** added as the falsy complement to `#if`. Two
    adjacent blocks (`#if X` … `#unless X`) replace the if/else pattern
    without dragging in `{{else}}` parsing.
  - **`autoFixYaml` now runs on every YAML save**, not just on AI-suggested
    YAML from the analyze flow. Hand-edited and pasted YAML get the same
    rescues (un-escape `{ {`, shorthand outputs, signal/template
    normalisation).
  - **`<iframe>` allowed conditionally** in `sanitizeHtml` — HTTPS only,
    host on a small allowlist (YouTube + Vimeo to start), with a forced
    `sandbox="allow-scripts allow-presentation"` regardless of input. Was
    unconditionally stripped before, which made video-embed templates
    impossible. Author-supplied sandbox attrs are overridden so an
    `allow-same-origin` injection can't escape.

- 6ddff4f: State directory hardening.

  Three additions to the `$STATE_DIR` primitive shipped in PR D, addressing the most likely operational/correctness concerns:

  **1. Per-agent size cap** — new `agent.stateMaxBytes` field (default 100 MB; set 0 to disable). Pre-node check refuses to run when the dir exceeds the cap, with a clear error pointing to `sua state prune <agent>`. The node that _exceeded_ the cap completes; the _next_ node fails. This attributes the error to a fresh node rather than retroactively failing one that already finished.

  **2. `sua state` CLI** — four subcommands for operational hygiene:

  - `sua state list` — every agent with a state dir, sorted by size
  - `sua state du <agent>` — per-file breakdown
  - `sua state prune <agent>` — clear contents (or `--remove` the dir)
  - `sua state export <agent> [path]` — `tar.gz` to path or stdout

  **3. Audit trail** — additive `stateBytesBefore` / `stateBytesAfter` columns on `node_executions`. Captured per node when the agent has a state dir. Dashboard run-detail shows the delta as a small badge (`state +12 KB`) on each node when the value changed. Useful for spotting which node is growing state unexpectedly.

  Implementation notes:

  - `stateDirSize(id, dataRoot)` is a recursive synchronous walk; for typical agent state (a few files) it's microseconds. Symlinks are skipped (don't follow, don't count target size). Race-tolerant: silently skips files removed mid-walk.
  - `stateMaxBytes` is stored as a flat column on the `agents` table (alongside `pulse_visible`, `dashboard_visible`) — operator policy that shouldn't bump the agent version when changed.
  - The CLI uses system `tar` for `export` (avoids bundling a tar library for a rarely-used verb).

  Live smoke confirmed: cap enforcement refuses run 2 when state from run 1 exceeded 1-byte cap (status: failed, category: setup). Audit trail captured `0 → 6` bytes on the successful first run.

  Closes critical items 1, 2, 3 from the security roadmap entry added in PR D. Items 4–7 remain on the future-work list in `docs/SECURITY.md`.

- e71ba5e: `$STATE_DIR` primitive for stateful agents.

  Agents that need to persist data across runs (diff-over-time, caches, last-fired markers) get a per-agent directory at `data/agent-state/<agent-id>/`. Created lazily on first use, chmod 0o700, removed automatically when the agent is deleted.

  Available as:

  - `$STATE_DIR` env var in shell nodes (and as a string in any built-in tool input)
  - `{{state}}` template token in claude-code prompts and built-in tool inputs (e.g. `file-write`'s `path:`)

  ```yaml
  nodes:
    - id: diff
      type: shell
      command: |
        mkdir -p "$STATE_DIR"
        PREV="$STATE_DIR/last-readme.md"
        NEW="$STATE_DIR/current-readme.md"
        echo "$UPSTREAM_FETCH_RESULT" > "$NEW"
        if [ -f "$PREV" ] && ! diff -q "$PREV" "$NEW" > /dev/null; then
          echo '{"changed":true}'
        fi
        cp "$NEW" "$PREV"
  ```

  Promotes the convention agents had been inventing by hand (`.sua/state/<id>/`) into a first-class primitive. Surfaced by Round 2 dogfood Bug 8: the README diff agent invented its own state convention, and downstream agents would each invent a different one.

  **Cascading delete**: `agentStore.deleteAgent(id)` now also removes `data/agent-state/<id>/`. Idempotent (no-op when the dir was never created). State is **not** swept by the run-retention timer — it persists until the agent is deleted.

  **New `DagExecutorDeps.dataRoot`**: optional. When set, the executor exposes the state dir; when absent, `$STATE_DIR` is unset and `{{state}}` resolves to empty string. Tests and one-shot CLI runs typically omit it. Production paths (dashboard run-now / build / replay / widget-run, `sua workflow run` / `replay`) thread it through automatically.

  **Known limitation**: `sua schedule start` uses the v1 chain executor (via `LocalProvider`), not the DAG executor — scheduled agents going through that path don't get `$STATE_DIR` yet. The migration to the v2 path will pick this up.

  Sandbox: agent ids are validated against the lowercase+hyphens regex before path resolution; `removeStateDir` re-checks for defense in depth.

- 539f569: Output widgets gain interactive controls.

  Agents can now declare a `controls:` array on `outputWidget` with three control types: `replay` (re-run inline, optionally with tweakable inputs), `field-toggle` (hide/show optional fields), and `view-switch` (tab-style switch between named field subsets — e.g. metric ↔ imperial). State lives in URL query params (`?wv=`, `?wh=`) so refresh resets to defaults and links can be shared. Renders on agent detail and run detail pages; Pulse tiles continue to render statically. The agent-builder prompt and discovery catalog teach the planner when to reach for each control type.

### Patch Changes

- 5610714: Dashboard: Agent Config tab UX cleanup.

  The per-agent Config tab (`/agents/<id>/config`) was a 7-card vertical stack ~2500px tall with seven competing primary buttons. This refactor cuts the page in half (~1400px), reorders sections by decision sequence (Variables → LLM → MCP → Secrets), promotes Variables to a full-width row above a two-column grid, collapses the heavyweight Output Widget and Notify editors when configured (with one-line "Set up" CTAs when not), and demotes gateway buttons so "Run now" is the only primary action above the fold. The agent Status dropdown moves to the page header next to "Run now" so lifecycle decisions live where runs are triggered. Persistence paths and form actions are unchanged.

- 3c77e9e: Dashboard: toggle MCP exposure from the agent Config tab.

  A new card on `/agents/<id>/config` flips `mcp: true/false` without editing YAML. Off → "Expose via MCP" button; on → "exposed" badge + "Stop exposing" button. The flip rewrites the agent record but does not restart the running MCP server — the form copy points at Settings → MCP for that.

- 1cba377: Dashboard: move Output Widget editor to its own page with sub-tabs, and make Preview match Pulse.

  The Output Widget editor was a ~1200px inline section on the Config tab — widget-type cards, contextual helper, field table, AI-template branch, interactive-mode subform, action bar, and live preview all stacked in one form. It now lives at `/agents/<id>/output-widget` with sub-tabs **Type**, **Fields**, **Interactive**, and **Preview** filtering which sections are visible. The action bar (Save / Remove) stays visible across all tabs. Save and validation errors return you to the editor (preserving iteration) instead of bouncing to Config. The Config tab's Output Widget card collapses to a one-line summary (`Type: dashboard, Layout: 5 fields, Interactive: yes`) plus an "Edit" link.

  Preview now respects `interactive: true`. When the editor's Interactive checkbox is on, the Preview tab renders the same `renderInteractiveWidget` Pulse uses (with the configured runInputs filter, askLabel, and replayLabel applied) — in `staticPreview` mode so clicks don't accidentally submit a real run. Previously the preview always rendered the static widget output, hiding the visual effect of every Interactive setting.

- 1531948: Dashboard: split `routes/agents.ts` and `views/agent-detail-v2.ts` into per-feature files.

  Internal refactor with no behaviour change. The 441-line agents router becomes a 22-line composition over six per-action modules under `routes/agents/`. The 466-line agent-detail view becomes a barrel over six per-tab renderers under `views/agent-detail/`. Adding new agent surfaces no longer requires scrolling through unrelated code.

- 85e01ee: mcp-server: fix crash on the second client connection.

  The MCP server reused a single `McpServer` instance across all sessions and called `server.connect(transport)` on it once per new session. The MCP SDK requires a fresh server per transport — the second connect threw `Already connected to a transport`, surfaced as an unhandled HTTP-parser exception, and crashed the process. Symptom: `claude mcp list` (or any second client) reported `Failed to connect` and `daemon status` showed the MCP service as `stale (pid dead)`. Now each session gets its own `McpServer`; `provider` and `agentDirs` are still shared. Closing the session also closes its server.

- 5fd8e74: Tidier `/nodes` catalog page.

  Cards are now collapsible (default collapsed), grouped by category (Execution / Control flow / Terminal), with a top toolbar that has a live filter (matches type, description, use-when, field names) plus collapse-all / expand-all buttons. Anchor chips at the top jump straight to a node type. Filter and per-card open state persist in sessionStorage so anchor clicks don't lose context.

- a5d41c1: Accept shorthand string form for `outputs:` declarations.

  LLM-generated YAML routinely writes `outputs.url: string` (the shorthand) instead of the verbose `outputs.url: { type: string }`. The schema now accepts both forms — the parser normalises the shorthand to the verbose object form, so downstream consumers always see the canonical shape. Fixes the painful "Fix with AI" loop where every Suggest improvements run hit the same `Expected object, received string` validation wall.

  The autofixer (run-now-build → autoFixYaml) also rewrites shorthand to verbose form so the canonical stored YAML stays stable in git.

  Camel-case output names (`mediaType`) still need to be renamed to snake_case (`media_type`) by hand — the schema can't auto-coerce keys without breaking template references.

- 746b1e5: Run detail: sticky DAG + result summary while scrolling node logs.

  The DAG visualization and result widget at the top of `/runs/:id` now stick to the viewport (capped at 60vh) while the node-execution panel scrolls below. On long runs with many nodes you keep the graph and final output in view instead of having to scroll back up. Falls back to a non-sticky stacked layout below 900px wide.

- Updated dependencies [5c2e83f]
- Updated dependencies [0042d16]
- Updated dependencies [5610714]
- Updated dependencies [3c77e9e]
- Updated dependencies [1cba377]
- Updated dependencies [0a73abe]
- Updated dependencies [0745598]
- Updated dependencies [b2f5498]
- Updated dependencies [1531948]
- Updated dependencies [38f2da6]
- Updated dependencies [475f28d]
- Updated dependencies [96b1089]
- Updated dependencies [bea09e7]
- Updated dependencies [0f93483]
- Updated dependencies [85e01ee]
- Updated dependencies [9bcce23]
- Updated dependencies [5fd8e74]
- Updated dependencies [29b524f]
- Updated dependencies [a5d41c1]
- Updated dependencies [647e172]
- Updated dependencies [746b1e5]
- Updated dependencies [6ddff4f]
- Updated dependencies [e71ba5e]
- Updated dependencies [539f569]
  - @some-useful-agents/core@0.20.0

## 0.19.0

### Minor Changes

- 16e3a74: `sua agent install <url>` — fetch + validate + import an agent over HTTPS.

  End-to-end install flow for sharing agents. The CLI verb fetches a YAML, validates against `agentV2Schema`, and writes through the same `upsertAgent` path that `sua workflow import-yaml` uses (DB-backed). The dashboard ships a paste / preview / confirm form at `/agents/install`, mirroring the v0.18 MCP import idiom.

  - `core/registry`: GitHub `/blob/<branch>/<path>` URLs are normalized to `raw.githubusercontent.com`; `gist.github.com/<user>/<id>` is resolved via the `/raw` redirect; plain HTTPS passes through. Size cap (256 KB) and 10-second timeout. URL gated by `assertSafeUrl` before fetch — link-local and loopback hosts are blocked.
  - CLI accepts `--from-gist`, `--auth-header "Bearer ..."` for private fetches (never persisted), `--yes` for non-interactive runs (refuses overwrite without `--force`), and `--force` to upgrade an existing id. ID-collision diff prompt shows declared inputs / secrets / mcp / schedule before confirming.
  - Trust model: install never auto-runs. `source` is always set to `local` regardless of what the YAML declares — the installer takes ownership. Community-host allowlist is deferred until a trusted host actually exists.
  - Dashboard `/agents/install` — three-step paste/preview/confirm form. Same `Authorization` header support as the CLI; never persisted.
  - A `vitest.config.ts` resolve alias is added so cross-package tests resolve workspace packages to source TS without a rebuild step.

  Pairs with the source-on-upgrade fix that ensures the installer-takes-ownership invariant holds across upgrades, not just initial installs.

- 76411f7: Two key shipped agents rewritten, plus a parser fix that was silently breaking both.

  **Parser fix.** `parsedToAgent` and `NODE_KEY_ORDER` in `agent-yaml.ts` had drifted from the v0.16+ schema, silently stripping `tool`, `action`, `toolInputs`, `onlyIf`, `conditionalConfig`, `switchConfig`, `loopConfig`, `agentInvokeConfig`, and `endMessage` from every YAML round-trip. Same shape as the `outputWidget` drift fix in #167. Any agent using MCP-driven tools or control-flow nodes lost those fields on import — so `graphics-creator-mcp` arrived in the DB as a sequence of bare `claude-code` nodes with no prompts, and `agent-analyzer`'s `onlyIf` skip-on-valid optimisation never fired because the field was dropped. Two new round-trip tests lock down every node field the schema accepts so the next addition can't slip through silently.

  **graphics-creator-mcp** — single-node rewrite. The previous 6-node theme → save → render → composite pipeline carried multiple latent bugs (missing prompts, broken upstream wiring, theme step that produced nothing reusable). New version is one `claude-code` node that calls the modern-graphics MCP server's `list_themes` + `generate_graphic` tools in one round-trip, returns structured JSON, and ships with an interactive output widget so the tile becomes a self-contained ask → render → preview loop on `/pulse`.

  **agent-analyzer** — three improvements to the "Suggest improvements" agent:

  - `fix` node now skips entirely when validate's `valid` field is true (saves a Claude round-trip on the happy path; this was already declared but didn't survive parsing — now does).
  - `fix` timeout raised from 90s to 240s and `maxTurns` from 2 to 4.
  - `fix` prompt rewritten to be tighter: leads with the validation error in an explicit fence, includes common fix recipes (shell-vs-template upstream refs, uppercase input names, missing enum values, control-flow configs), and emphasises "minimal change" so Claude doesn't try to redesign the agent on every fix attempt.

  **Dashboard fix-attempt fallback** — the inline auto-fix used by the "Suggest improvements" modal had `timeout: 60s` / `maxWait: 65s` / `maxTurns: 1`, no slack for any non-trivial agent. Bumped to `timeout: 180s` / `maxWait: 200s` / `maxTurns: 3`. When the auto-fix still doesn't return in time, the new error message points users to "Edit manually" with the suggested rewrite as a starting point, rather than implying the dashboard is broken.

- 16e3a74: `sua daemon` — run schedule, dashboard, and (optional) MCP as detached background services.

  New top-level CLI verb with `start | stop | restart | status | logs` subcommands. PIDs and rotated logs live under `<dataDir>/daemon/`; existing scheduler heartbeat is reused for health detail. Detached subprocesses re-invoke the local `sua` binary with the corresponding verb so config and env propagate cleanly.

  - `sua daemon start` spawns the configured services, waits for them to settle, then reports per-service `started` / `crashed on startup` (with log path) / `already running`. Children that crash are caught by a post-spawn liveness check, not silently presented as running.
  - `sua daemon status` shows pid + scheduler heartbeat + a clickable URL column for services that bind a port. URLs render as OSC 8 hyperlinks in TTY-aware terminals; non-TTY contexts (pipes, file redirects) emit plain text. Dashboard URL embeds `/auth#token=<token>` so a click in a fresh browser completes the auth handshake without bouncing through a sign-in page.
  - New optional `daemon` config block: `services` (default `[schedule, dashboard]`), `logRotateBytes` (default 10 MB), plus separate `dashboardPort` (default 3000) and `dashboardBaseUrl` (default loopback) fields. Daemon now passes `--port` through to `dashboard start` and `mcp start` so configured ports actually take effect under supervision.
  - The scheduler now idles instead of exiting when zero agents have a `schedule:` field, so the daemon can supervise a dashboard-only project without the schedule slot flickering "stale (pid dead)".
  - Dashboard `startDashboardServer` rejects its listen promise on `'error'` events (e.g. EADDRINUSE) instead of hanging — the previous behavior left the daemon thinking the dashboard was running while it never bound.

  Closes the "schedules don't fire when the terminal closes" gap from the v0.19 operationalization plan.

- 16e3a74: Notify Slack messages now include a clickable run link.

  The notify dispatcher already supported a run-link in Slack Block Kit messages — the slack handler builds `<base/runs/<id>|Open run in dashboard>` when `dashboardBaseUrl` is on the dispatch context. Earlier release just never wired that field from any of the four sites that call `executeAgentDag`, so the link never rendered in practice.

  End-to-end plumbing in this release:

  - New optional `dashboardBaseUrl?: string` field on `SuaConfig` plus a `getDashboardBaseUrl()` helper that falls back to `http://127.0.0.1:<dashboardPort>`. Override when the dashboard is behind a reverse proxy or bound to a non-loopback host that the notify destination needs to reach.
  - `sua workflow run` and `sua workflow replay` pass the resolved base URL into executor deps.
  - `startDashboardServer` accepts an optional `dashboardBaseUrl` (CLI passes it from config; tests can override). Stored on `DashboardContext` (default `http://<host>:<port>` if not supplied). Run-now and replay routes thread `ctx.dashboardBaseUrl` into executor deps.
  - Integration test asserts the slack handler payload contains the expected dashboard link when `dashboardBaseUrl` is set on deps.

- e0b4d96: Interactive widgets — turn pulse tiles into mini-apps.

  Output widgets gain an opt-in `interactive: true` flag. When set, the pulse tile renders with an inline inputs form + Run button + state machine that polls `/runs/:id/widget-status` until the run completes — no navigating away. Each tile becomes a self-contained ask → think → answer → ask again loop with smooth CSS transitions between states.

  Five visible states (`idle | asking | running | success | error`) cross-fade at ~220 ms with a `transform: translateY` so content doesn't pop. The tile gets a subtle pulsing border while running so it reads as "active" at a glance from the pulse page. `prefers-reduced-motion` disables the animations.

  Schema additions on `outputWidget` (all optional):

  - `interactive: boolean` — opts the tile into the new mode
  - `runInputs: string[]` — subset of `agent.inputs` to expose in the form (defaults to all)
  - `askLabel: string` — overrides the initial Run button text (default "Run")
  - `replayLabel: string` — overrides the post-result button text (default "Run again")

  Two new dashboard routes:

  - `POST /agents/:name/widget-run` — accepts `input_*` form fields and returns `{ runId }` JSON. Reuses the existing DAG executor and auth.
  - `GET /runs/:id/widget-status` — lightweight `{ status, result, error }` JSON polled every 500 ms.

  Polling caps at 60 s (120 ticks) → tile transitions to a "still running, view details" state with a link to `/runs/:id`. Cancel button hooks the existing `/runs/:id/cancel` route.

  The output widget editor on agent config gains an "Interactive mode" disclosure: a checkbox to enable, checkboxes per declared input to filter what the tile shows, and label overrides for both buttons.

  Non-interactive widgets are completely unchanged. Existing widgets without the flag render in the same static mode they always have.

  Plan: `~/.claude/plans/interactive-widgets.md`.

  Out of scope (deferred):

  - Widget cross-fade replaces the result with the raw text in a `<pre>` for now; live re-render of the actual widget HTML on completion is a follow-up (the next pulse refresh swaps in the proper widget).
  - Streaming intermediate node outputs into the tile.
  - Channel/file/secret pickers tied to specific input types beyond text/number/enum/boolean.

- 4c8de94: Form-based notify editor for the dashboard.

  Replaces the JSON textarea on agent config with a structured form. Top-level checkboxes for `on` (failure/success/always), a comma-separated list for declared `secrets`, and per-handler cards with type-specific fields:

  - **slack** — `webhook_secret` dropdown (populated from the secrets list), `channel`, `mention`
  - **file** — `path`, `append` checkbox
  - **webhook** — `url`, `method` (POST/PUT), `headers_secret` dropdown (optional, also populated from the secrets list)

  Three "+ Add slack / + Add file / + Add webhook" buttons let operators compose the handler array without remembering schema field names. Removing a handler is an in-row "Remove" button. Saving serializes the form state to a single hidden `notify_json` field; the route validates the payload through the same `agentV2Schema` as the YAML import path so cross-checks (e.g. handler-referenced secrets must be declared) still fire.

  Backwards compat: the route accepts either the new `notify_json` field (preferred) or the legacy `notify` JSON blob — ad-hoc API callers and existing tests aren't broken.

  Out of scope (future): live Block Kit preview for slack handlers; channel picker via Slack OAuth (depends on PR-C); secret-name autocomplete (the cross-check at save time covers typos).

- 16e3a74: `notify:` field on agent v2 — fire user-declared handlers on run failure / success / always.

  After a DAG run commits its final state, the executor dispatches handlers in parallel and isolated. A broken Slack webhook can never turn a successful run into a failed one — handler exceptions are caught, logged via the existing logger, and never propagate back into the run.

  Three builtin handler types:

  - **slack** — POSTs a Block Kit message to a Slack incoming webhook URL stored as a secret. Headline (status emoji + agent name + status), agent id / run id / start+complete timestamps, last 200 chars of error if failed, and (when `dashboardBaseUrl` is configured) a clickable link back to the run page. Optional `mention` and `channel` fields.
  - **file** — appends a JSON line per fire to a project-cwd-scoped path. Reuses the file-write builtin's path-traversal guard.
  - **webhook** — generic `POST` with body `{ agent, run_id, status, started_at, completed_at, error?, output? }`. Optional secret-backed `Authorization` header. URL gated by the existing `assertSafeUrl` SSRF guard.

  Schema corrects the original plan's assumption that `{{secrets.X}}` templates work in handler config: secrets in this codebase are env-var-only at the node level, so notify config declares its own `secrets:` list and the dispatcher resolves values from the secrets store. A zod cross-check rejects handlers that reference an undeclared secret. `{{vars.X}}` template substitution works in string fields like `channel`, `path`, and `url` via the existing template helpers.

  Dashboard agent config gets a JSON-textarea editor for the notify block and a `POST /agents/:name/notify/update` route alongside the existing widget editor pattern. Email handler intentionally not in this release — defer until Slack proves the pattern.

- 12627d1: `sua workflow rm <id>` and dashboard delete — hard-delete agents.

  Closes the gap where `archive` was the only way to "remove" a v2 DB-backed agent. Archived agents stayed visible in `sua workflow list` and held the id namespace, making test fixtures and abandoned agents hard to clean up.

  - New CLI verb `sua workflow rm <id>` shows agent metadata (status, source, version count, run count + last fire, schedule), then a `[y/N]` confirmation prompt. `--yes` skips the prompt for scripts.
  - New dashboard "Danger zone" disclosure section on the agent overview tab. The form requires the operator to **type the agent id verbatim** before the browser will submit — the input's `pattern` attribute enforces the exact match. The route also re-validates the confirm token server-side, so a client bypassing the form still can't accidentally delete.
  - Both surfaces use the existing `AgentStore.deleteAgent`, which cascades to `agent_versions` rows but leaves runs intact (runs reference agent id as a string, no FK). Run history is preserved as append-only — clicking the agent column in /runs for a deleted agent now 404s with a "this agent has been deleted" hint, but the run row itself is still inspectable.

  Refuses to delete an agent that's invoked by another agent's `agent-invoke` node (existing core behavior — the error message names the dependent agents). No `--purge-runs` or cascade-runs flag; orphan-cleanup is a separate utility (deferred).

### Patch Changes

- 77ab55b: Fix YAML round-trip silently stripping `outputWidget` fields.

  `agent-v2-schema.ts` carried its own inline `outputWidget` zod definition that had drifted from the canonical `outputWidgetSchema` in `output-widget-schema.ts`. Anything that round-tripped agents through YAML (`workflow import-yaml`, `agent install`, `workflow export` → re-import) lost the missing fields silently because zod accepted the document but the inline definition didn't list those keys.

  Drift accumulated over time:

  - `ai-template` widget type
  - `preview` field type
  - `prompt` and `template` fields (ai-template generator output)
  - `interactive`, `runInputs`, `askLabel`, `replayLabel` (PR #166)

  Fix: the inline schema is replaced with `outputWidgetSchema.optional()` so there's a single source of truth.

  Surfaced when adding `interactive: true` to the Magic 8-Ball agent via `workflow export → patch → workflow import-yaml` and observing the field disappear on re-export. Also fixes the latent bug where ai-template widgets authored via the dashboard couldn't survive YAML round-trip — they parsed cleanly but the prompt/template fields were stripped.

  No agent data migration needed; existing DB-stored widgets keep their fields and now correctly survive a YAML round-trip.

- 16e3a74: Fix `sua agent install` not propagating `source: local` when upgrading an existing agent.

  The install path explicitly built its upsert payload with `source: 'local'` to honor its installer-takes-ownership contract, but both branches of `upsertAgent` (metadata-only update when DAG unchanged, new-version creation when DAG differs) called `updateAgentMeta` with a patch that omitted `source`, and `updateAgentMeta`'s type signature didn't accept it either. So an existing row with `source: 'examples'` would stay `examples` even after `sua agent install --force`, quietly violating the documented contract.

  `updateAgentMeta` now accepts `source` and writes it. Both `upsertAgent` paths pass `agent.source` through. New test in `AgentStore.upsertAgent` covers source change across both upsert paths (identical DAG → metadata-only update; differing DAG → new version).

  Initial installs of new agents were unaffected — `createAgent` honored `agent.source` directly. Only upgrades hit the bug.

- a7d1bf0: Fix `/agents` list page silently dropping flash banners.

  Mutation routes that redirect to `/agents?flash=...` (e.g. the new hard-delete from PR #162) had their messages dropped — the GET handler never read `req.query.flash` and `AgentsListInput` had no `flash` field, so the `layout()` call rendered without a banner. Users would delete an agent and see nothing change visually beyond the agent disappearing.

  Wires the `flash` end-to-end: route reads `req.query.flash` (kind=ok) and `req.query.error` (kind=error), `AgentsListInput` accepts the optional banner, and the layout renders it via the existing `flash--ok` / `flash--error` styles already used by `/runs`. Test added.

  Same pattern as `/runs` and the agent detail page already use; agents-list was the odd one out.

- 16e3a74: Add `.claude/` to `.gitignore` so subagent worktree directories from Claude Code sessions can't accidentally land in commits as embedded git repositories.

  No runtime impact; repo-hygiene only.

- 3d42b6b: Fix interactive widgets rendering raw JSON in a `<pre>` on completion.

  PR #166's interactive widgets shipped with a known follow-up: when a run completed in the tile, the result body got pretty-printed JSON instead of the actual widget. The proper widget render only appeared on the next pulse refresh, which broke the in-place feel — the whole point of interactive mode.

  Fix: `GET /runs/:id/widget-status` now server-renders the agent's `outputWidget` against the run result and includes a `widgetHtml` string in the response when the run is `completed` and the agent has a widget. The tile JS swaps that HTML into the result box on success, with the same fade-in transition as before. Falls back to the prior `<pre>` behavior when no widget is configured (e.g. agent without an outputWidget) or the widget renderer rejects the result.

  Same renderer that powers the static pulse tile now runs on the widget-status endpoint, so the rendering is identical between first-load and post-run states. No client-side widget logic to keep in sync.

- be8ef64: Fix interactive widgets resizing during state transitions.

  PR #166's interactive widgets used `display: none` to hide inactive panes (asking / running / success / error / stuck), which removed them from the layout entirely. That meant the tile's height jumped between states — the form pane is one height, the spinner-only running pane is much shorter, the result is variable, the error card is somewhere in between. Asking → running → success felt jarring as the container resized twice.

  Fix: switch to a CSS Grid stack. All panes share the same grid cell (`grid-template-areas: 'stack'`), so the cell's height is `max(child heights)` and stays stable across transitions. Inactive panes get `opacity: 0; visibility: hidden; pointer-events: none` instead of `display: none`, so they keep contributing to the cell sizing without affecting interaction. CTA rows also pin to the bottom via `margin-top: auto` so the Run button sits in the same place regardless of pane content.

  Short panes (running, stuck, error) center vertically inside the cell so they don't anchor awkwardly to the top of an oversized container. The container also gets a `min-height: 8rem` baseline so the very first pre-run render doesn't open at zero height.

- 16e3a74: Fix `/runs` page-size links rendering raw `<a>` HTML as escaped text.

  The page-size selector in the runs list footer was building anchor tags as plain strings concatenated with `.join(' ')`, then interpolating into a `html\`...\``template tag — which escapes string values. The result was visible literal`<a href="...">25</a>` text instead of clickable links.

  Switched to the same SafeHtml-fragment pattern the agents-list and tools-list pagers already use, so each link is a `html\`...\`` template literal that the renderer treats as trusted markup.

- 77687c5: Three small polish fixes surfaced during v0.19 testing rounds:

  **SSRF error copy is no longer caller-specific.** `assertSafeUrl` originally said `"http-get and http-post only allow requests to public addresses"` — accurate when it shipped, but `agent install` and the notify dispatcher now call it too. Generalized to `"SSRF protection: only public addresses are allowed."` so the message reads correctly from every caller.

  **`secrets rm` and `secrets remove` work as aliases for `secrets delete`.** Both are common muscle-memory choices (`rm` from shell, `remove` from npm). The canonical command stays `delete`; the aliases are commander-level so help text shows `delete|rm <name>` and either token resolves.

  **Deflaked the post-spawn settle test.** `waitForServiceSettle reports stale when the child dies during the settle window` was relying on a 20ms-vs-100ms timing window that lost on slow CI machines (occasional one-fail-out-of-many runs). Replaced the timer-based race with a deterministic `child.once('exit', ...)` await before the settle — verified 5× without a flake.

- Updated dependencies [16e3a74]
- Updated dependencies [77ab55b]
- Updated dependencies [16e3a74]
- Updated dependencies [a7d1bf0]
- Updated dependencies [76411f7]
- Updated dependencies [16e3a74]
- Updated dependencies [16e3a74]
- Updated dependencies [16e3a74]
- Updated dependencies [3d42b6b]
- Updated dependencies [be8ef64]
- Updated dependencies [e0b4d96]
- Updated dependencies [4c8de94]
- Updated dependencies [16e3a74]
- Updated dependencies [16e3a74]
- Updated dependencies [77687c5]
- Updated dependencies [12627d1]
  - @some-useful-agents/core@0.19.0

## 0.18.0

### Minor Changes

- 9b2956c: AI-generated output widget templates.

  New `ai-template` widget type: describe the layout in plain English, Claude generates an HTML template, we sanitize and reuse it for every run. Fields can be referenced via `{{outputs.NAME}}` and the raw output via `{{result}}`; values are HTML-escaped before substitution and the rendered result is run back through the sanitizer at render time (defense-in-depth).

  **Abstracted LLM provider** so Codex/Gemini/etc. can plug in via `registerTemplateGenerator()` without route changes. Ships with Claude (`claudeTemplateGenerator`) by default, spawning the local `claude --print` binary with a strict system prompt.

  **Pure tag/attribute allowlist sanitizer** (`sanitizeHtml`, zero deps). Strips `<script>`, `<iframe>`, `<form>`, `on*` handlers, `javascript:`/`vbscript:` URLs, and non-image `data:` URLs. Preserves SVG with its cased attributes (`viewBox`, `gradientUnits`, etc.) so generators can emit inline charts.

  **UX:** Generate click opens a modal with a spinner, elapsed-seconds counter, and a Cancel button wired through `AbortController` + `req.close` so Claude is actually killed on cancel.

  New exports from core: `sanitizeHtml`, `substitutePlaceholders`, `claudeTemplateGenerator`, `getTemplateGenerator`, `listTemplateGenerators`, `registerTemplateGenerator`.

- 9b2956c: New builtin tool + example agents for data visualization.

  - **`csv-to-chart-json`** builtin — turns CSV (inline or file path) into the JSON shape `modern-graphics-generate-graphic` expects. Three shapes: `simple` (labels + values), `series` (labels + named series), `cohort` (date + size + values). CSV parser handles quoted fields and escaped quotes.
  - **`graphics-creator-mcp`** example agent — topic + audience brief → modern-graphics theme creation → hero render → composite overlay. Demonstrates MCP tool chaining end-to-end.
  - **`chart-creator-mcp`** example agent — CSV input → `csv-to-chart-json` → `modern-graphics-generate-graphic`. Supports all 22 chart layouts via enum dropdown.

- 9b2956c: MCP servers as a first-class entity.

  Tools imported from an MCP server are now grouped under a named server record. The new `mcp_servers` SQLite table plus an additive `mcp_server_id` column on `tools` lets the dashboard manage whole servers at once — enable/disable gates every tool from that server without deleting anything, delete cascades to all its imported tools.

  - New `type: 'mcp'` tool implementation with pooled MCP client (stdio + streamable-HTTP)
  - `/tools/mcp/import` accepts a Claude-Desktop/Cursor `mcpServers` config, a bare map, or a single `{command,args,env}` entry. JSON and YAML. Multi-server paste discovers every entry in parallel and groups the picker by server.
  - `/tools/mcp/import` also has a "Quick add by URL" shortcut for HTTP servers.
  - `/settings/mcp-servers` — table with tool counts, enable/disable toggle, cascade delete.
  - Executor gate: nodes referencing a tool from a disabled server fail with `errorCategory: 'setup'` and a clear "server X is disabled" error.
  - Tool detail page shows the source server with a link back to settings.

  Parser exported from core: `parseMcpServersBlob`, with per-entry errors so a partially-valid blob still yields the servers that _are_ valid.

- 9b2956c: Output Widget editor made self-teaching.

  Replaced the bare widget-type dropdown with a card picker. Each card has a description, ASCII layout sketch, and context-aware helper copy that updates as you switch. Field-type dropdown gains per-type tooltips and dims types that don't apply to the selected widget.

  New **"Load example"** dropdown with 5 starter widgets (Report card, Metric dashboard, File preview, Diff applier, Key-value summary) that populate the form in one click.

  New **live preview card** below the form that rerenders the widget with synthetic sample data on every edit. Backed by a new `POST /agents/:id/output-widget/preview` route — no DB writes — that reuses the existing `renderOutputWidget()` renderer.

  Matching polish on the Pulse "Output Widget" tile explainer so both surfaces use the same vocabulary.

### Patch Changes

- 9b2956c: Dashboard polish bundle.

  - **/tools** now has **User** / **Built-in** tabs with per-tab counts and pagination — replaces the combined grid where builtins filled the first page.
  - **/agents** gets the same treatment: **User** / **Examples** tabs (and a conditional **Community** tab when relevant). Source filter dropdown folded into tabs.
  - **Variables editor** supports `enum` inputs end-to-end: new values column that accepts comma-separated or JSON-array form; enum without values surfaces a clear error instead of silently saving.
  - **Pagination size links** (`12 24 48 100`) rendered correctly on `/tools` — previously HTML-escaped by the tagged template.
  - **Pulse "Output Widget" tile** explainer is now informative: describes the four widget types, how fields map to output, and links to `/agents/<id>/config`.

- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
- Updated dependencies [9b2956c]
  - @some-useful-agents/core@0.18.0

## 0.17.0

### Minor Changes

- 998e881: Security: SSRF protection on http-get/http-post, auth token moved from URL query param to fragment, CSP + security headers on dashboard, Postgres bound to localhost in Docker Compose.

### Patch Changes

- Updated dependencies [998e881]
  - @some-useful-agents/core@0.17.0

## 0.16.1

### Patch Changes

- **docs: update READMEs for v0.16 features.**

  All package READMEs updated to reflect Pulse, build-from-goal, tabbed agent detail, filtering/pagination, LLM defaults, and security improvements.

- Updated dependencies
  - @some-useful-agents/core@0.16.1

## 0.16.0

### Minor Changes

- **feat: goal-driven agent builder + self-correcting analyzer.**

  Build-from-goal wizard: describe what you want in plain language, the builder designs a complete DAG. Self-correcting: validates YAML and fixes errors automatically. Agent analyzer reviews existing agents and suggests improvements with "Apply now" one-click save. Dynamic tool catalog injected into builder prompt. Focus prompt and last-run output context for analyzer. Auto-fix shell template mistakes.

- **feat: dashboard UX overhaul — design system, tabs, filtering, pagination.**

  Design system: dark mode default, JetBrains Mono, warm stone neutrals, teal accent. Home page with output previews and activity feed. CSS consolidation (~200 inline styles → reusable classes). Agent detail page refactored from 2-column inspector to 5-tab layout (Overview, Nodes, Config, Runs, YAML). Agent-level provider/model defaults with dropdown UI. Filtering and sorting on agents list (search, status, source, sort). Filtering on tools list. Pagination (12 per page) on both. Node executions auto-expand on completion. "Suggest improvements" button on failed run pages.

- 170dd4c: **feat: node edit + delete in the dashboard (PR 3a of 5 for v0.15).**

  Closes the last big create/edit gap: users can now modify existing nodes and remove them without dropping to YAML or the CLI. Every change becomes a new version in the audit history.

  ### What ships

  - **`GET /agents/:id/nodes/:nodeId/edit`** — form pre-filled with the node's current state (type, command/prompt, dependsOn). Node id is **read-only** — renaming would break every `{{upstream.<id>.result}}` / `$UPSTREAM_<ID>_RESULT` reference in the same agent. Users who want a different id delete + re-create.
  - **`POST /agents/:id/nodes/:nodeId/edit`** — validates + writes a new version via `createNewVersion`. Commit message is auto-set to `Edited node "<id>"`. Cycle guard re-runs server-side; the form's picker already hides downstream nodes but a hand-crafted POST can't bypass it.
  - **`POST /agents/:id/nodes/:nodeId/delete`** — removes the node + creates a new version. Refuses if:
    - Any other node depends on this one (clear flash: `Cannot delete "fetch" — "digest" depends on it.`)
    - The agent has only one node (delete the agent itself from the CLI instead)
  - **Inline Edit + Delete buttons** on every row of the agent detail Nodes table.

  ### Design notes

  - **Node ids are immutable.** The form shows them in a disabled input with a hint explaining why. Rename becomes delete-and-recreate.
  - **Downstream-dep check on delete is explicit, not cascading.** Auto-trimming dependents' `dependsOn` would silently reshape the DAG; a loud refusal makes the user confront the consequence.
  - **Cycle guard uses colored-DFS.** Faster than re-running the full Zod schema for one topology check; re-validates only the edge under consideration.
  - **Fields not yet editable from the UI** (inputs, secrets, env, envAllowlist, allowedTools, model, maxTurns, timeout, redactSecrets) are preserved on edit — the form keeps them untouched, so editing a shell node's command doesn't wipe its secrets. Those land in PR 3b (the richer inspector) alongside drag-drop.

  ### Files

  - New: `packages/dashboard/src/views/agent-edit-node.ts`
  - Modified: `packages/dashboard/src/routes/agents.ts` (GET + POST for /edit, POST for /delete, plus `hasCycleAfterEdit` helper); `views/agent-detail-v2.ts` (Edit/Delete buttons on node rows + new Actions column)

  ### Tests

  55 total (48 → 55; +7 new):

  - GET edit pre-fills the form + id input is read-only
  - POST edit updates the node + bumps the version + leaves downstream alone
  - POST edit refuses a cycle-producing dependsOn with a 400
  - POST delete refuses when any node depends on the target
  - POST delete removes the node + bumps the version when nobody depends on it
  - POST delete refuses to remove the last node (1-node agent)
  - Agent detail renders Edit + Delete buttons on every row

  ### Plan

  Remaining v0.15 PRs: **3b (DAG drag-drop visual, deferred as its own PR) → 4 (settings CRUD + passphrase modal + MCP rotate) → 5 (replay UI + polish)**. v0.16 plan for structured outputs + Claude/Codex AI-assist comes after v0.15 wraps.

- d0ec3fc: **feat: replay on DAG click + node action dialog + template palette + polish (PR 5 of 5, closes v0.15).**

  Turns the DAG viz into the primary interaction surface (not a decoration above a table), adds a command-palette style autocomplete to node command/prompt textareas, and tightens the empty/error states the earlier PRs in this bundle didn't quite nail.

  ### Node action dialog

  - **Click any DAG node** on `/runs/:id` or `/agents/:id` to open an action dialog. Dialog shows the node's id, type badge, status badge (run detail only), depends-on list, and duration — plus context-specific action buttons.
  - **On `/runs/:id`** (terminal runs only): "Replay from here" button POSTs to `/runs/<priorRunId>/replay` with the clicked node as `fromNodeId`. Community shell agents add a confirm prompt + the audit flag. "Jump to details" scrolls to the per-node card below.
  - **On `/agents/:id`**: "Edit node" link jumps into `/agents/:id/nodes/:nodeId/edit`. When a latest completed run exists, "Replay from here" points at that run for one-click re-execution.
  - Uses the browser-native `<dialog>` element so ESC + backdrop clicks + focus return are free.
  - Replaces the misleading "Click a node to inspect it" inspector hint — the interaction now actually exists and the hint tells the truth.
  - Below-DAG "Replay" form is now a `<noscript>` fallback for users without JS.

  ### Template palette (autocomplete for `$` and `{{`)

  - Typing `$` in a **shell** textarea opens a floating palette with every available env-var injection:
    - `$UPSTREAM_<ID>_RESULT` for each other node in the agent
    - `$<INPUT>` for every declared agent-level input
    - `$<SECRET>` for every secret declared on the node
  - Typing `{{` in a **claude-code** prompt textarea opens the same idea with template refs:
    - `{{upstream.<id>.result}}` per upstream node
    - `{{inputs.<NAME>}}` per agent input
  - Keyboard: Up/Down to navigate, Enter/Tab to insert, Esc to close. Substring match + position-scored ranking.
  - Suggestions are computed server-side from the agent's node list + declared inputs + per-node secrets, embedded as a JSON payload in a `<script type="application/json">` tag — same pattern Cytoscape uses for its element payload.
  - Wired into both `/agents/:id/add-node` and `/agents/:id/nodes/:nodeId/edit`. Friendly inline hint below each textarea.

  ### Replay / empty / error polish

  - `POST /runs/:id/replay` — validates prior run is a v2 DAG run + agent exists + node is valid; dispatches `executeAgentDag` with `replayFrom`; 303s to the NEW run's page on success, flashes back to the prior run on failure.
  - `/runs` with zero runs renders a dedicated "No runs yet" card pointing to the Agents page + CLI. `/runs?agent=ghost` (filters + no matches) renders "No runs match" + a Reset filters link.
  - `/runs/<missing>` 303-redirects to `/runs` with a flash explaining the run may have been pruned by the retention policy. No more raw `<p>` fallback.
  - `/runs/:id` surfaces flash banners for replay errors via an error-vs-ok regex classifier in the route.

  ### Design notes

  - **Dialog chosen over popover.** The browser-native `<dialog>` element handles ESC, backdrop clicks, and focus return without extra JS. Building a custom popover positioned over a Cytoscape canvas gets messy fast.
  - **Replay always redirects to a new run.** Even on executor-side validation failure (missing upstream snapshot), the executor creates a failed run row for the audit trail. The dashboard flashes back to the prior run's page for those cases to keep the flow consistent.
  - **Palette doesn't filter by `dependsOn:` checkboxes.** Users can type a reference to a node they haven't yet marked as an upstream; save-time Zod validation catches it. Wiring the palette to live checkbox state adds complexity without clear value — the "helpful error at save" path already exists.
  - **Palette is inline JS, not a new asset.** The handler is ~180 lines; adding a second `/assets/*.js` file for it adds a network round-trip without material benefit. When the palette grows (v0.16 structured-outputs will add path completions), promote to its own asset file.

  ### Files

  - New: `packages/dashboard/src/routes/run-mutations.ts` (replay route), `packages/dashboard/src/views/template-palette.ts` (suggestions helper + payload renderer)
  - Modified: `views/dag-view.ts` (replay/editBase props + `<dialog>` shell), `routes/assets.ts` (node-click dialog logic in `graph-render.js` + additional per-node data), `views/run-detail.ts` (replay context + noscript fallback, removed inline replay form), `views/agent-detail-v2.ts` (editBase + replay wiring + honest hint), `views/agent-add-node.ts` + `views/agent-edit-node.ts` (palette wiring), `views/js.ts` (palette client), `routes/runs.ts` (flash classification + 303 on missing run), `views/runs-list.ts` (empty-state split), `assets/screens.css` (dialog + palette styles), `index.ts` (wire run-mutations router)

  ### Tests

  87 dashboard tests total (75 → 87; +12 new):

  - DAG wires `data-replay-run-id` on completed v2 runs + `<dialog>` shell present + click-hint rendered
  - No replay wiring on in-progress runs
  - Agent detail wires edit-base + replay-latest + replaced misleading inspector hint
  - `POST /replay` — missing node, unknown node, valid node, cross-origin refusal
  - `GET /runs/<missing>` redirect
  - Empty / filtered empty states
  - Palette JSON payload on add-node form (all candidate upstreams)
  - Palette JSON payload on edit-node form excludes the node under edit

  ### Plan

  v0.15 is feature-complete with this PR. Release work (changeset consolidation, CHANGELOG polish, version bump) happens via the Changesets release PR (#64). Post-v0.15: see `~/.claude/plans/agents-as-packages.md` and `~/.claude/plans/dashboard-revamp.md` for where this is heading.

- 663af58: **feat: settings CRUD in the dashboard — secrets + MCP token rotation (PR 4 of 5 for v0.15).**

  Moves the last CLI-only admin surfaces into the dashboard so operators can manage secrets and rotate the MCP bearer token without leaving the browser. Unblocks v0.16 AI-assist, whose Anthropic API key needs the `/settings/secrets` surface to have a home.

  ### What ships

  - **`/settings/secrets`** — list declared secret names (values never rendered), set a new secret, delete an existing one. Agent-declared secrets that aren't yet set are called out in a "Declared by agents but not set" list so missing config is visible without running `sua doctor`.
  - **Passphrase unlock flow** — when the store is `v2` passphrase-protected, the page renders a dedicated unlock form instead of the list. A correct passphrase is cached in dashboard-process memory for the rest of the session; never written to disk, cookies, or sessionStorage. A "Lock now" button clears it.
  - **`/settings/general`** — MCP token fingerprint (first 8 chars), retention-policy display, path block showing the run DB, secrets file, and MCP token file so users know where sua is reading and writing.
  - **MCP token rotation** — one-click rotate from `/settings/general`. The handler writes a fresh token to `~/.sua/mcp-token`, updates the in-process auth check, re-mints the dashboard session cookie so the operator stays signed in, and reveals the new value exactly once. Existing MCP clients (Claude Desktop) break until they're updated — the confirm dialog spells that out.
  - **`/settings/integrations`** — placeholder unchanged in behaviour, with copy updated to reflect that integrations are a later-release feature.

  ### Design notes

  - **Origin check is the CSRF defence.** Every POST under `/settings/*` flows through `requireAuth`, which already rejects non-loopback `Origin` headers. No second CSRF token layer needed.
  - **Passphrase never persisted.** Cached in a closure on the `SecretsSession` instance, cleared on `lock()` and at process shutdown. Dashboards that crash or restart require re-unlock — intentional.
  - **Declared-secrets discovery tolerates broken YAML.** A malformed agent file must not prevent the settings page from rendering; `collectDeclaredSecrets` swallows loader errors and falls back to what the v2 store knows.
  - **Rotated token is shown inline, not via flash.** `?rotated=<token>` in the redirect URL renders once on `/settings/general`; we accept that a browser back/reload can re-display it because the dashboard is a local loopback and the user asked to see it.

  ### Files

  - New: `packages/dashboard/src/secrets-session.ts` (SecretsSession interface + `EncryptedFileSecretsSession` + `MemorySecretsSession` for tests), `packages/dashboard/src/views/settings-secrets.ts`, `packages/dashboard/src/views/settings-general.ts`, `packages/dashboard/src/secrets-session.test.ts`
  - Modified: `packages/dashboard/src/routes/settings.ts` (real CRUD + unlock/lock/rotate routes), `context.ts` (tokenPath, secretsPath, dbPath, retentionDays, rotateToken, secretsSession), `index.ts` (wire new context fields + construct the session), `views/js.ts` (add `[data-confirm]` submit handler), `assets/screens.css` (settings-form styles), `packages/cli/src/commands/dashboard.ts` (pass retentionDays)

  ### Tests

  75 dashboard tests total (55 → 75; +20 new):

  - Unlock form gates the list when passphrase-protected + locked
  - Wrong passphrase is rejected; correct passphrase unlocks the session
  - `POST /settings/secrets/set` validates the `^[A-Z_][A-Z0-9_]*$` name pattern, rejects writes while locked, and stores + redirects on success
  - `POST /settings/secrets/delete` removes a stored secret
  - `POST /settings/secrets/lock` clears the cached passphrase
  - Cross-origin POST to `/settings/secrets/set` is refused (Origin check)
  - `/settings/general` renders the token fingerprint + retention + paths and never leaks the full token
  - `POST /settings/general/rotate-mcp-token` rotates, re-mints the session cookie, updates `ctx.token`, and reveals the new value once
  - After rotation, the old cookie is rejected and the new one authenticates
  - `/settings/integrations` renders placeholder copy
  - `EncryptedFileSecretsSession` round-trips through a real file, enforces passphrase gating, and throws when writing while locked
  - `MemorySecretsSession` simulates the passphrase-protected flow for dashboard tests

  ### Plan

  Remaining v0.15 PR: **5 (replay UI + microcopy polish + changeset release for the v0.15-follow-on bundle)**. v0.16 structured-outputs work comes after v0.15 wraps.

- 0f002da: **feat: agent version history + status toggle + rollback (PR 2 of 5 for v0.15).**

  Makes the "every save = new version" story visible and actionable. Users can now see the full history of an agent's DAG, rollback to any prior version, and toggle an agent's lifecycle state from the UI — no more dropping to the CLI for `sua workflow status`.

  ### What ships

  - **Status dropdown** on the agent detail inspector aside — `active` / `paused` / `draft` / `archived`. Writes through `POST /agents/:id/status` → `agentStore.updateAgentMeta`. Same values the CLI accepts.
  - **`GET /agents/:id/versions`** — table of every version with creation time, author, commit message, and a rollback button per non-current row. Current version is highlighted.
  - **`GET /agents/:id/versions/:version`** — single-version viewer showing the DAG as it was at that point in time, with a "Rollback to this version" primary CTA.
  - **`POST /agents/:id/rollback`** — reconstructs the target version's DAG and calls `createNewVersion` to produce a NEW version whose structure matches the target. Append-only: nothing is deleted, rollback is itself a versioned event.
  - Agent detail inspector gains:
    - A **"history →"** link next to the version field
    - A **"Versions"** button in the action row
    - (Already had "+ Add node" from PR 1.6)

  ### Design choices

  - **Rollback creates, doesn't mutate.** The alternative — setting `current_version` back to v1 — would hide the rollback from history. Creating a new v3 that matches v1's DAG is auditable and reversible.
  - **Status is metadata, not a version.** `updateAgentMeta` doesn't bump the version because status isn't part of the DAG schema. Only structural changes produce new versions.
  - **No diff view yet.** Showing a side-by-side DAG diff between v1 and v2 requires editor context to be useful; deferred to PR 3. For now, the single-version view shows each version's DAG in isolation.
  - **No general-purpose `POST /agents/:id/save` endpoint yet.** Without the editable inspector (PR 3) there's no UI to trigger it, and designing the API without a consumer risks getting it wrong. Lands alongside PR 3.

  ### Files

  - New: `packages/dashboard/src/views/versions.ts`
  - New: `packages/dashboard/src/routes/versions.ts` (versions list, single version, rollback, status)
  - Modified: `views/agent-detail-v2.ts` (inspector aside now has Status section + versions links), `index.ts` (mounts the new router)

  ### Tests

  48 total (41 → 48; +7 new):

  - `/agents/:id/versions` lists all versions with current marked
  - `/agents/:id/versions/:version` renders the DAG as it was at that version
  - Rollback creates a new version matching the target DAG, with a "Rollback to vN" commit message
  - Rollback rejects invalid target version (404)
  - Status toggle changes status + rejects invalid enum values
  - Agent detail renders the status dropdown form + versions link

  ### Plan

  Remaining v0.15 PRs: **3 (inspector editing + drag-drop) → 4 (settings CRUD + passphrase modal + MCP token rotate) → 5 (replay UI + states/microcopy polish)**.

- 96e5add: **feat: connected tutorial + in-UI create surface + DAG polish (PR 1.6 of v0.15).**

  Closes the gap from v0.15.0's first pass: the tutorial was a read-only status tracker and every "create X" step dead-ended at the CLI. This PR makes the dashboard an actual create surface.

  ### What ships

  - **`/agents/new`** — dashboard form that creates single-node v2 DAG agents via `agentStore.createAgent`. Validates id, name, command/prompt. No terminal handoff.
  - **`/agents/:id/add-node`** — form that appends a node to an existing agent, bumps to a new agent version via `upsertAgent`. Supports multi-node DAG authoring from the UI with a `dependsOn` checkbox set limited to existing node ids. Post-submit stays on the same form with a "Added X" flash so users can chain another node; "Done here — view DAG" exits to the agent detail.
  - **Active tutorial at `/help/tutorial`** — every step now has an inline action button, not a nav link:
    - Step 1: "Create hello agent" button → POST scaffolds a minimal single-node agent → redirects to `/agents/hello?from=tutorial` so the user immediately sees the DAG + composition.
    - Step 2: "Run <first-agent> now" button → POST runs it inline, flashes the user onto the run detail.
    - Step 4: "Scaffold demo DAG" button → creates a 2-node fetch→digest demo → redirects to `/agents/demo-digest`.
    - Every step shows a **"Will create" preview card** up front so the user sees the DAG shape + commands BEFORE clicking the button.
  - **Multi-hop back navigation** — new `?from=<origin>` query propagates through POST redirects (tutorial → agent detail → run detail). Back link label reflects the _original_ origin, not the immediate Referer. Handles the "I ran hello from the tutorial, now the run detail should offer Back to tutorial" case.
  - **DAG viewer unified + collapsible** — fixed a styling inconsistency where `/runs/:id` and `/agents/:id` rendered the DAG with different chrome (one used inline styles overriding the design-system class). Canvas now uses a dot-grid background, softer status/type tints, thinner edges, mono label font. Wrapped in a `<details open>` so deep pages can collapse the viz without scrolling past it.
  - **Multi-node agent cards** on `/agents` gain an inline `<details>` revealing each node's id + type + command snippet without navigating away.
  - **Contextual back link** on run detail — reads `Referer` (falls back to query param, same-origin only) and renders "← Back to runs / tutorial / agents / <agent-id>" above the page title. Off-host referers are ignored.
  - **Available variables panel** on the add-node form — lists every upstream node with its claude-code template syntax (`{{upstream.<id>.result}}`) and shell env-var form (`$UPSTREAM_<ID>_RESULT`) so authors don't have to remember. Notes that structured outputs arrive in v0.16.
  - **`docs/templating.md`** — reference doc for the current templating vocabulary plus a forward-looking sketch of the v0.16 structured-outputs expansion.

  ### Files

  - New: `packages/dashboard/src/views/{agent-new,agent-add-node,tutorial}.ts`
  - New: `packages/dashboard/src/routes/help.ts` scaffold endpoints (POST `/help/tutorial/scaffold-hello`, POST `/help/tutorial/scaffold-demo-dag`)
  - New: `docs/templating.md`
  - Modified: `views/{agents-list,agent-detail-v2,run-detail,dag-view,page-header}.ts`, `routes/{agents,runs,run-now,help,assets}.ts`, `assets/{components,screens}.css`
  - `page-header.ts` grows a `deriveBack(referer, host, fromParam)` helper the routes use to produce the contextual link.

  ### Tests

  41 total (35 → 41; +6 new):

  - Scaffold endpoints create + are idempotent + show inline action buttons
  - `/agents/new` renders form, creates on POST, rejects invalid id + dup id + missing prompt-for-claude-code
  - `/agents/:id/add-node` renders with current nodes, appends + bumps version, rejects unknown upstream, rejects duplicate node id
  - Back link renders for same-origin Referer, omitted for off-host

  ### Notes

  - The AI-assist idea ("Suggest with Claude" / "Write with Codex") is scoped to v0.16 alongside structured outputs — it needs the declared-outputs schema to have useful context. Plan file coming.
  - `/agents/new` creates single-node agents only. The chain flow (`/agents/:id/add-node`) covers multi-node authoring. Real inline drag-drop + version diff lands in PR 3 of v0.15.

- **feat: Pulse information radiator dashboard.**

  New /pulse page: customizable information radiator with signal tiles showing agent output as live widgets. 9 display templates (metric, text-headline, table, status, time-series, image, text-image, media, + backward compat). Container layout system with drag-and-drop reorder. Edit mode toggle. Widget palette (6 color options). Auto-theming by template type. Conditional thresholds. System metric tiles replace hardcoded health strip. Markdown rendering in text tiles. YouTube click-to-play media player. Tile collapse/expand. All agents wired with signal blocks.

- 9a5af08: **feat: tool CLI + /tools dashboard + tool visibility on agent detail (PR 3 of 6 for v0.16).**

  Surfaces the tool abstraction from PRs 1–2 so users can browse, inspect, and validate tools from both the CLI and the dashboard.

  ### What ships

  - **`sua tool list`** — tabular listing of all built-in + user-defined tools with id, source, implementation type, description.
  - **`sua tool show <id>`** — detailed view of a tool's inputs (name, type, required, default, description) + outputs + implementation.
  - **`sua tool validate <file>`** — schema-check a tool YAML without storing it. Reports each Zod issue with path + message.
  - **`/tools`** dashboard page — card grid of all tools, split into "Built-in tools" and "User tools" sections. Reuses the agent-card component.
  - **`/tools/:id`** detail page — inputs table, outputs table, implementation card, back-link to /tools.
  - **Tool visibility on agent detail sidebar** — new "Tools" section between Secrets and action buttons. Lists the unique tool ids this agent's nodes reference, each as a clickable badge linking to `/tools/:id`. v0.15 nodes show their implicit tool (`shell-exec` / `claude-code`).
  - **"Tools" nav link** in the topbar — sits between Agents and Runs.

  ### Tests

  521 total (517 → 521; +4 new):

  - `/tools` lists built-in tools
  - `/tools/http-get` renders detail with inputs/outputs
  - `/tools/nonexistent` redirects to /tools
  - Agent detail sidebar shows tool badge for implicit shell-exec

- 21cc114: **feat: tool picker on node forms + tool config/actions types (PR 4 of 6 for v0.16).**

  Replaces the Shell/Claude Code type radio on add-node and edit-node forms with a tool dropdown listing all 9 built-in tools + user tools. Selecting a tool dynamically renders its declared input fields with palette autocomplete (both `$` and `{{` triggers). Extends the tool model with `config` (project-level defaults) and `actions` (multi-action tools).

### Patch Changes

- 1744a9f: **feat: branch (merge) node + dashboard viz shapes (Flow PR F — closes flow control).**

  Final flow-control PR. Adds the `branch` merge-point node and distinct Cytoscape shapes for all control-flow node types.

  - **`branch` node**: explicit fan-in merge point. Collects all upstream outputs into `{ merged: Record<string, unknown>, count: number }`. Condition-skipped upstreams are excluded gracefully (the branch always runs, even if some paths were skipped). Bypasses the condition_not_met cascade that would otherwise skip downstream nodes with a skipped dependency.
  - **Dashboard viz shapes**: conditional/switch = diamond, loop = round-octagon, agent-invoke = barrel, branch = round-pentagon, end/break = octagon. Each control-flow type also has a distinct color tint so the DAG at a glance shows where routing happens vs where execution happens.

  ### Flow control is complete

  With PRs A–F, agent flows now support:

  - `conditional` — if/else predicate evaluation
  - `switch` — multi-case routing
  - `loop` — iterate over arrays with sub-agent invocation
  - `agent-invoke` — nested sub-flows with parent-child run linking
  - `branch` — explicit fan-in merge
  - `end` — clean early termination
  - `break` — exit current loop iteration
  - `onlyIf` — edge-level conditional execution on any node

- Updated dependencies
- Updated dependencies [544fb33]
- Updated dependencies
- Updated dependencies [2ca929d]
- Updated dependencies [b94f89b]
- Updated dependencies [4b97cc8]
- Updated dependencies [8b95d36]
- Updated dependencies [48c57f8]
- Updated dependencies [1744a9f]
- Updated dependencies
- Updated dependencies [3fe5c47]
- Updated dependencies [2cb27af]
- Updated dependencies [21cc114]
- Updated dependencies [6c25718]
- Updated dependencies [ffa2986]
  - @some-useful-agents/core@0.16.0

## 0.15.0

### Minor Changes

- 628b742: **feat: dashboard visual foundation + IA refactor (PR 1 of 5 for v0.15).**

  Locks a design system and refactors the information architecture before v0.15's editor and settings features land. No behavior changes to the run/agent/secrets flows — visible surface only.

  ### What ships

  - **Design system as real CSS.** Replaces the inlined `css.ts` template-literal with four source files under `packages/dashboard/src/assets/`: `tokens.css` (colors, type, spacing, radius, shadow), `base.css` (element defaults), `components.css` (badges, tables, buttons, flash, tab strip, modal, page header, filters), `screens.css` (per-screen grids). Concatenated at startup and served as `/assets/dashboard.css` with a 5-minute `Cache-Control`. Copied from `src/assets/` to `dist/assets/` by a new `copy-assets.mjs` post-build step, wired into the root `build` script.
  - **Layout shell.** Adds a Settings + Help nav entry, a sticky footer with version + GitHub + Docs + Help links, and a shared `pageHeader()` component so every detail screen exposes the primary CTA in the same spot.
  - **Agent detail (`/agents/:id`) → 2-column grid.** DAG viz stays on the left (60%); a right-column inspector panel shows agent metadata + secrets summary today and will become the node inspector in PR 3. Nodes / Secrets / Recent runs collapse into ordered sections under the grid.
  - **Agents list → single table by default.** Unmigrated v1 YAML agents now hide inside a `<details>` disclosure ("Show N legacy v1 agents") instead of appearing inline.
  - **Run detail → click-expandable node cards.** Each per-node execution renders as a `<details>` card; failed/errored nodes open by default so the user doesn't scroll hunting for failures, successful nodes collapse.
  - **`/settings` skeleton.** New route tree with a tab strip (Secrets | Integrations | General), placeholder content in each. Concrete CRUD + passphrase modal + MCP token rotation land in PR 4.
  - **`/help` route.** Static reference page listing the CLI surface grouped by purpose (getting started, agents & workflows, scheduling, secrets, MCP & dashboard), showing which commands map to dashboard features and which stay CLI-only. Includes a "Dashboard in 60 seconds" quick tour and a pitch for `sua tutorial`.

  ### Design tokens summary

  - Type scale: 13 / 14 / 17 / 22 / 28
  - Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48 (0.25rem–3rem)
  - Radius: 6 / 10 / 14
  - Shadow: subtle by default; `--shadow-md` reserved for modals + inspector slide-in (PR 3)
  - Teal primary kept (brand continuity); contrast verified AA (4.98:1 primary on white, 4.67:1 muted on bg)
  - Legacy class-name aliases (`.badge-ok`, `.flash-error`, `.run-now`, `.run-now-warn`, etc.) live in a compat block at the bottom of `components.css` so existing v1 view code keeps rendering without churn; removed in a follow-up PR once every callsite uses the BEM-style `.badge.badge--ok`.

  ### Files

  - New CSS: `packages/dashboard/src/assets/{tokens,base,components,screens}.css`
  - New scripts: `packages/dashboard/scripts/copy-assets.mjs`
  - New views: `packages/dashboard/src/views/{page-header,footer,help,settings-shell}.ts`
  - New routes: `packages/dashboard/src/routes/{settings,help}.ts`
  - Modified: `layout.ts` (stylesheet link + footer + nav), `agent-detail-v2.ts` (2-col + inspector aside), `agents-list.ts` (v1 disclosure), `run-detail.ts` (node cards), `components.ts` (BEM badge names), `routes/assets.ts` (serves concatenated CSS), `index.ts` (mounts settings + help routers)
  - Deleted: `packages/dashboard/src/views/css.ts`
  - Infrastructure: root `package.json` build script runs `copy-assets.mjs` after `tsc --build`

  ### Constraints preserved

  - No CDN, no bundler, no client framework
  - No new external dependencies
  - Existing 420-test suite still passes; no behavior regressions

  ### Plan

  Full scope in `~/.claude/plans/dashboard-v0.15.md`. Remaining v0.15 PRs:

  - PR 1.5 — dashboard-native tutorial at `/help/tutorial` (step-by-step guided flow)
  - PR 2 — mutation endpoints + version history + status toggle
  - PR 3 — node inspector editing + DAG drag-drop
  - PR 4 — settings CRUD + passphrase modal + MCP token rotation
  - PR 5 — replay UI + states & microcopy polish

- b210ec1: **feat: dashboard-native tutorial at `/help/tutorial` (PR 1.5 of v0.15).**

  A guided first-run flow that replaces the "open a terminal and run `sua tutorial`" friction for users who're already in the dashboard. Step completion is derived from observable project state (agent count, run count, DAG run presence, declared secrets) — not session cookies — so refreshing re-checks reality.

  ### Steps

  1. **You have a project** — done when any agent is registered. Empty-state pitches `sua init`.
  2. **Run your first agent** — done when any run exists. CTA deep-links to the friendliest starting agent (prefers a single-node v2 over a multi-node, v2 over v1).
  3. **Inspect the output** — done when a run exists AND a latest-run id is available. CTA links to the latest run.
  4. **See a multi-node DAG in action** — done when any run has `workflowId` set. Empty-state explains how to build one.
  5. **Wire up a secret** — done when any agent node declares a secret. CTA links to Settings → Secrets.

  ### Why state-derived, not session-tracked

  A cookie-based wizard remembers what you _clicked_, not what's _true_. If a user clicks through to step 3 and then deletes all their runs, the cookie still says "done". Sourcing from the DB + agent store means the tutorial always reflects the current project — and a second visitor to the dashboard (or the same user on a fresh cookie) sees accurate state on first load.

  ### Files

  - New: `packages/dashboard/src/views/tutorial.ts`
  - Modified: `packages/dashboard/src/routes/help.ts` (new `/help/tutorial` route handler pulls state from `agentStore` + `runStore` + `loadAgents`); `views/help.ts` (replaces the "Start here: `sua tutorial`" card with a prominent link to the dashboard tutorial, keeps the CLI command as a secondary option)

  ### Tests

  3 new cases in `dashboard.test.ts` (23 → 26):

  - `/help` renders with the tutorial CTA + CLI reference
  - `/help/tutorial` marks step 1 done when agents exist, surfaces "1 of 5 complete" when no runs yet
  - `/help/tutorial` deep-links the Run CTA to the first agent id

### Patch Changes

- @some-useful-agents/core@0.15.0

## 0.14.0

### Minor Changes

- b7c73aa: **feat: dashboard DAG visualization + per-node execution table (PR 5 of 5 for agents-as-DAGs).**

  Completes the v0.13 user story: import your v1 YAML into DAG agents, run them, watch them in the dashboard with a real graph view and per-node logs.

  ### What ships

  - **`/agents` page** splits into two tables: v2 "DAG agents" (from AgentStore) at the top, unmigrated v1 YAML agents below. An id that exists in both tables collapses to the v2 row; the v1 header only appears when there are v1-only agents to show.
  - **`/agents/:id`** (v2 variant) renders the DAG visually via Cytoscape.js (client-rendered from a server-supplied `<script type="application/json">` payload). Nodes are round-rectangles colored by type (shell green / claude-code magenta) with edges pointing downstream. `<noscript>` fallback lists nodes textually. "Run now" dispatches to the DAG executor; community-shell DAGs require confirmation.
  - **`/runs/:id`** gains a per-node execution table for DAG runs: status, error category, duration, exit code. The DAG viz renders here too, with nodes color-coded by their execution status (completed / failed / running / skipped / cancelled). Each row links to a per-node detail section with stderr and stdout. "Replayed from …" breadcrumb shown when present.
  - **Static assets** served from `/assets/cytoscape.min.js` + `/assets/graph-render.js` with long-cache headers. Cytoscape is resolved from `node_modules` at startup; no CDN, no bundler.

  ### Files

  - New: `packages/dashboard/src/routes/assets.ts`, `views/dag-view.ts`, `views/agent-detail-v2.ts`
  - Modified: `context.ts` (adds AgentStore), `index.ts` (opens AgentStore via shared path), `routes/agents.ts` (v2-first lookup), `routes/run-now.ts` (dispatches to DAG executor for v2), `routes/runs.ts` (joins node_executions for v2 runs), `views/agents-list.ts` (two-table split), `views/run-detail.ts` (DAG + per-node table when v2)

  ### Design constraints preserved

  - No CDN
  - No bundler (cytoscape vendored through npm, served from node_modules)
  - No framework (client JS = 2KB vanilla bootstrap)
  - v2 tagged-template rendering for everything HTML

  ### Tests

  8 new cases in `dashboard.test.ts`:

  - v2 agents appear under a "DAG agents" header on `/agents`
  - `/agents/:id` renders the Cytoscape JSON payload with correct nodes + edges
  - v2 preferred over v1 when same id in both
  - `/runs/:id` shows per-node table + DAG for v2 runs
  - `/runs/:id` stays minimal for v1 runs (no per-node UI)
  - Replayed-from breadcrumb renders when present
  - `/assets/cytoscape.min.js` serves (~100KB+)
  - `/assets/graph-render.js` serves with correct content-type

  412 → 420 repo-wide.

  ### Manual verification

  ```bash
  sua workflow import --apply
  sua workflow run <agent-id>
  sua dashboard start --port 3000
  # /agents → DAG agents table
  # /agents/<id> → DAG rendered + node list
  # /runs/<id> → per-node table + DAG colored by node status
  ```

  ### Deferred to v0.14

  - Drag-and-drop DAG editing (plan's v0.14 scope)
  - Node inspector (edit secrets/inputs/env in UI)
  - Version history view + diff + rollback in UI
  - `/settings/*` tree (secrets / integrations / general)
  - Version-aware DAG rendering (currently shows current_version's DAG for all runs; a follow-up can pull the exact version the run executed)
  - `LocalProvider.submitDagRun` unification (MCP + scheduler still dispatch to v1 chain-executor — dashboard now dispatches DAG directly)

### Patch Changes

- Updated dependencies [f7c0689]
- Updated dependencies [b7c73aa]
- Updated dependencies [31fd09f]
  - @some-useful-agents/core@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [e8b3079]
- Updated dependencies [0e21b19]
  - @some-useful-agents/core@0.13.0

## 0.12.0

### Minor Changes

- 689b77a: **feat: `sua dashboard start` — read-only web UI with run-now + runs filter/pagination.** Closes v0.12's scope: a monitoring + nudge surface that complements the CLI without duplicating it.

  ### What ships

  - `sua dashboard start [--port 3000] [--host 127.0.0.1]` boots an Express app that shares the MCP bearer token at `~/.sua/mcp-token` for auth. Prints a one-time sign-in URL; cookie is the token itself, `HttpOnly` + `SameSite=Strict`, 8-hour expiry.
  - **Routes:** `/` redirects to `/agents`; `/agents` lists everything loadable with type/source badges; `/agents/:name` shows resolved YAML, declared inputs, live secrets-status (green/red/"unknown (store locked)" when v2 passphrase-protected), recent runs, run-now button.
  - **`/runs` — runs list with filters and pagination.** Agent dropdown + Triggered-by dropdown + multi-status checkboxes (OR within, AND across) + free-text `?q=` that prefix-matches on run id and substring-matches on agent name (case-insensitive). `?limit=` default 50, max 500. `?offset=` Prev/Next links preserve all filter state through the URL query string.
  - **`/runs/:id` — run detail** with status badge, timing, output frame, error pane. In-progress runs inline a 2-second poll via vanilla JS that swaps the container fragment without a full page reload.
  - **Run-now gate.** Local/examples agents submit directly. Community shell agents show a modal with the command and require an explicit audit checkbox before submit; the server double-checks `confirm_community_shell=yes` on the POST. Provider-level `UntrustedCommunityShellError` still applies — the modal is a UX, not a security, gate.
  - **Defenses** match MCP: `127.0.0.1` bind by default, Host + Origin allowlists (identical to the MCP server's, now shared via `@some-useful-agents/core/http-auth`), cookie-based session, CSRF defense via Origin check.

  ### New types + API

  - `Run.triggeredBy` adds `'dashboard'` to the union.
  - New `DashboardContext` exported from `@some-useful-agents/dashboard` for test harnesses that want to drive `buildDashboardApp(ctx)` via supertest without spinning an HTTP listener.

  ### Dependencies

  Adds `supertest` + `@types/supertest` (dev) to the dashboard package. Runtime deps unchanged — the UI is tagged template literals + inlined CSS/JS, no framework, no bundler, no CDN.

  ### Tests

  `packages/dashboard/src/dashboard.test.ts` — 15 supertest cases covering auth flows (cookie round-trip, Host/Origin rejection, wrong-token 401), filter routing (agent / status OR / unknown-status defense / pagination link preservation), and the run-now gate (community modal refusal without confirm, provider gate still fires with confirm).

  302 tests total across the repo (was 287; +15 new).

  ### Out of scope (deferred)

  - Custom-input form for run-now (YAML defaults only, as in the plan)
  - Editing YAML or setting secrets from the UI
  - Mermaid topology view of agent chains (planned for v0.13 alongside LLM-discoverable docs)

  ### Manual verify

  ```bash
  cd /tmp && mkdir sua-play && cd sua-play
  sua init
  sua agent run hello
  sua dashboard start --port 3000
  # Click the printed auth URL → cookie set → bookmark /
  # Explore /agents, /runs, try the run-now button.
  ```

### Patch Changes

- Updated dependencies [a84193d]
- Updated dependencies [689b77a]
  - @some-useful-agents/core@0.12.0

## 0.11.0

### Patch Changes

- ad651db: **fix: don't open the secrets store for agents that declare no secrets.**

  v0.10.0 regression: `LocalProvider.submitRun` and `runAgentActivity` both called `secretsStore.getAll()` unconditionally for every run, which meant any agent — even one with no `secrets:` field — needed the store to be unlockable. On a v2 passphrase-protected store that turned every run into "set SUA_SECRETS_PASSPHRASE or nothing works", which was never the intent.

  Now the store is only opened when the agent actually declares secrets. Regression test in `local-provider.test.ts` uses a store that throws on any read and asserts the provider never touches it for an agent with no `secrets:` field.

- Updated dependencies [a21055c]
- Updated dependencies [ad651db]
  - @some-useful-agents/core@0.11.0

## 0.10.0

### Minor Changes

- b855d95: **security: passphrase-based KEK for the secrets store (v0.10.0).** Closes the last finding from the original `/cso` audit. `data/secrets.enc` now encrypts under a key derived from a user passphrase via scrypt (N=2^17, r=8, p=1) with a per-store random salt, instead of the v1 hostname+username seed. A payload-exfil attacker can no longer decrypt the store by guessing trivially-known machine attributes.

  ### What changed

  - New v2 payload format: `{ version: 2, salt, iv, tag, data, kdfParams, obfuscatedFallback? }`. Salt and KDF parameters live alongside the ciphertext so we can tune scrypt upward in future versions without breaking old stores — readers honor whatever the file says.
  - Passphrase prompt on `sua secrets set` against a cold or v1 store. Confirmed twice before write. An empty passphrase explicitly opts into the legacy hostname-derived key and writes `obfuscatedFallback: true` into the payload so every subsequent read loudly warns.
  - New `sua secrets migrate` command: decrypt a v1 or v2-obfuscatedFallback store with the legacy key, re-encrypt under a new passphrase. Atomic via tempfile + rename.
  - `sua doctor --security` reports the store's encryption mode: `v2 passphrase-protected` (green), `v2 obfuscatedFallback` / `legacy v1` (red, points at `sua secrets migrate`).
  - `SUA_SECRETS_PASSPHRASE` environment variable is read by every code path that opens the store — required for CI/non-TTY contexts running scheduled agents against a v2 passphrase-protected store.
  - Legacy v1 payloads still decrypt for reads (with a warning on every load). First write auto-migrates to v2 under whatever passphrase the caller provides; run `sua secrets migrate` to upgrade without having to set a new secret first.

  ### Migration

  If you have an existing v0.9.x install with a `data/secrets.enc` on disk:

  ```bash
  # Option A: explicit migrate
  sua secrets migrate

  # Option B: auto — the next `sua secrets set` or `sua secrets delete` migrates
  sua secrets set ANY_KEY
  ```

  Both routes prompt for a new passphrase (or accept an empty one to stay on the legacy hostname key with an on-by-default warning).

  ### CI / non-TTY

  Set `SUA_SECRETS_PASSPHRASE` in the environment. A non-TTY `sua secrets set` against a cold store without the env var exits 1 with a clear error. If you want to preserve the pre-v0.10 zero-friction behavior, set `SUA_SECRETS_PASSPHRASE=` (explicit empty string) — this is treated as "use the legacy hostname-derived key" and is labeled as such in both the payload and in `sua doctor --security`.

  ### Rejected alternatives

  - **`keytar` / OS keychain** — native dependency that breaks `npx` on fresh machines (libsecret missing on Linux, Rosetta issues on M-series Macs). We may revisit with a pure-JS implementation later; for now, passphrase with empty-fallback covers the threat model without native bindings.
  - **Auto-derived "machine key" from additional attributes** — still guessable for a targeted attacker. Passphrase is the honest primitive.

  ### Not in this release

  - `sua secrets rotate-passphrase` — planned for v0.11 or later.
  - Keyfile-as-alternative-to-env-var (`SUA_SECRETS_KEYFILE`) — planned for v0.11 or later.
  - Dashboard badge for store encryption mode — v0.11.0 consumes the state surfaced by this release.

### Patch Changes

- Updated dependencies [b855d95]
  - @some-useful-agents/core@0.10.0

## 0.9.0

### Minor Changes

- b80d772: **feat: typed runtime inputs for agents.** Callers can now supply named, typed values at invocation time and agents substitute them into prompts or read them as environment variables. Closes the "I want my agent to take a parameter" story.

  ### Declare once, use everywhere

  ```yaml
  name: weather-verse
  type: claude-code
  prompt: "Weather for zip {{inputs.ZIP}} as a {{inputs.STYLE}}."
  inputs:
    ZIP:
      type: number
      required: true
    STYLE:
      type: enum
      values: [haiku, verse, limerick]
      default: haiku
  ```

  ```bash
  sua agent run weather-verse --input ZIP=94110
  sua agent run weather-verse --input ZIP=10001 --input STYLE=limerick
  ```

  ### Two execution models, one declaration

  - **claude-code agents** — `{{inputs.X}}` in the prompt (and in `env:` values) is substituted before spawn. Claude reads the resolved text; no injection class because prompts aren't executed.
  - **shell agents** — declared inputs become env vars. Authors write `"$ZIP"` in their commands; bash handles quoting. `{{inputs.X}}` inside a shell `command:` is rejected at load time with a clear error pointing to the `$X` form.

  ### Types

  | `type`    | Accepts                                           | Notes                           |
  | --------- | ------------------------------------------------- | ------------------------------- |
  | `string`  | any string                                        | default if unspecified          |
  | `number`  | `Number(x)` must be finite; empty string rejected | renders as decimal string       |
  | `boolean` | `true/false/1/0/yes/no` (case-insensitive)        | renders as `"true"` / `"false"` |
  | `enum`    | values listed in the spec's `values` array        | must declare `values`           |

  Type is for _validation at the boundary_, not downstream coercion. Every resolved input renders as a string — `{{inputs.VERBOSE}}` with `VERBOSE=true` substitutes the literal text `"true"`.

  ### Precedence (highest wins)

  1. `sua agent run --input K=V` (per-invocation)
  2. `sua schedule start --input K=V` (daemon-wide override, applies to every fired run; agents that don't declare the input ignore it)
  3. YAML `default:` (per-agent)
  4. Else fail loudly (`MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`)

  ### Load-time checks

  - `inputs:` names must be `UPPERCASE_WITH_UNDERSCORES` (env-var convention)
  - `type: enum` must declare a non-empty `values:` array
  - Every `{{inputs.X}}` in prompt or `env:` values must appear in the `inputs:` block (typos caught before execution)
  - Shell `command:` cannot contain `{{inputs.X}}` — use `$X` instead

  ### Run-time checks

  Ordered: undeclared provided key → invalid type → missing required. All fail before spawn, recorded as a failed run in history.

  ### New exports from `@some-useful-agents/core`

  - `AgentInputSpec` type
  - `inputSpecSchema` — zod schema
  - `resolveInputs(specs, provided, options?)` — returns resolved string map or throws
  - `validateAndRender(name, spec, raw)` — single-value validator
  - `extractInputReferences(text)` — returns set of `{{inputs.X}}` names
  - `substituteInputs(text, resolved)` — applies the map to a string
  - `MissingInputError`, `InvalidInputTypeError`, `UndeclaredInputError`
  - `RunRequest` — formalized `submitRun` request shape with optional `inputs`

  ### API changes (library consumers)

  - `Provider.submitRun(request: RunRequest)` — request type now has `inputs?: Record<string, string>`.
  - `ExecutionOptions.inputs?: Record<string, string>` on `executeAgent`.
  - `ChainOptions.inputs?: Record<string, string>` on `executeChain` — flows to every agent in the chain.
  - `LocalSchedulerOptions.inputs?: Record<string, string>` — daemon-wide overrides applied to every fired run.
  - Temporal activities/workflows carry `inputs` in their payload so workers on other hosts inherit the caller's input values.

  ### Docs

  - README commands table and full-fat YAML example updated to show `inputs:` and `--input`.
  - ROADMAP lists v0.9.0 under "Now".
  - `sua agent audit` prints declared inputs with types, defaults, required flags, and descriptions.

### Patch Changes

- Updated dependencies [b80d772]
  - @some-useful-agents/core@0.9.0

## 0.8.0

### Minor Changes

- a171b77: **feat(cli): visual polish pass across every command.** One voice, one look. No behavior changes, no API changes.

  ### What shipped

  - **New `packages/cli/src/ui.ts`** — shared helpers (`ui.ok`, `ui.fail`, `ui.warn`, `ui.info`, `ui.step`, `ui.section`, `ui.banner`, `ui.outputFrame`, `ui.kv`, inline helpers `ui.agent`/`ui.cmd`/`ui.dim`/`ui.id`). Every command now routes its status lines through these helpers instead of reaching for `chalk.green/red/yellow` directly.
  - **Unified emoji symbol set** — ✅ success, ❌ failure, ⚠️ warning, 💡 info, 🚀 next-step. Tutorial's 🎭 dad-joke flourish preserved. Output looks the same whether you run `sua init`, `sua doctor --security`, or `sua agent new`.
  - **Boxed daemon banners** — `sua mcp start`, `sua schedule start`, and `sua worker start` now print a `boxen` banner with the config details instead of loose dim-text lines. Adds one new dep (`boxen@^8`, ~8KB, no surprises).
  - **Custom top-level `sua --help`** — now includes an Examples block and pointers to `docs/SECURITY.md` + the repo. `showHelpAfterError(true)` so unknown commands print help automatically.
  - **Unified output frame** — `sua agent run` and `sua agent logs` both wrap captured stdout in `╭── output ──╮ / ╰────────────╯` (was duplicated ad-hoc dim dashes in both files).
  - **`sua agent audit` key/value rows** go through `ui.kv()` instead of a command-local `row()` helper.
  - **`STATUS_COLORS` centralized** — moved from `commands/status.ts` to `ui.ts` so `status`, `schedule`, and future surfaces agree on what color a `running` / `pending` / `failed` run is.

  ### Files touched

  **New:**

  - `packages/cli/src/ui.ts`
  - `packages/cli/src/ui.test.ts` — 20 tests, pure stdout capture, covers every helper.

  **Modified (every command):**

  - `packages/cli/package.json` — add `boxen` dep
  - `packages/cli/src/index.ts` — Examples block + `showHelpAfterError`
  - All 13 command files: `init.ts`, `list.ts`, `status.ts`, `run.ts`, `cancel.ts`, `logs.ts`, `mcp.ts`, `schedule.ts`, `worker.ts`, `secrets.ts`, `doctor.ts`, `audit.ts`, `new.ts`, `tutorial.ts`

  ### Tests

  196 total (was 176; +20 new in `ui.test.ts`). Zero existing tests changed — the polish doesn't alter any assertable behavior. Lint + build clean.

  ### User-visible diffs

  - Every success line is now `✅  Created foo.yaml` instead of green-only `Created foo.yaml`.
  - Every error line is `❌  Agent "foo" not found.` instead of `Error: Agent ...` / bare red.
  - Every warning is `⚠️  ...` instead of `Warning: ...`.
  - `sua mcp start` / `sua schedule start` / `sua worker start` print a cyan-bordered banner with host/port/paths.
  - `sua --help` ends with an Examples block.
  - Run output is framed in a unicode box.

  If you were grepping command output in scripts (you shouldn't be), those strings changed. No machine-readable output was altered (JSON / tables / exit codes are all identical).

  ### Non-goals

  Deferred — not in this PR:

  - Switching `readline/promises` → `@inquirer/prompts` for `sua agent new` / `sua tutorial` (UX shift, separate design pass).
  - Timing info on `sua agent run` (`"completed in 2.3s"`).
  - Progress bars for long chains.
  - Themeable colors via config.

### Patch Changes

- Updated dependencies [a171b77]
  - @some-useful-agents/core@0.8.0

## 0.7.0

### Minor Changes

- 51155a4: **feat: `sua agent new` — interactive agent scaffolder.** Graduates users from "I ran an example" to "I authored an agent" without hand-writing YAML. Closes the _Interactive agent creator_ roadmap item.

  ### What it does

  `sua agent new` walks through a short prompt flow:

  1. **Type** — shell or claude-code (default shell)
  2. **Name** — validated against `[a-z0-9-]+` at prompt time
  3. **Description** — optional one-liner
  4. **Command** (shell) or **Prompt + Model** (claude-code)
  5. **Customize more?** — gate to the advanced fields
     - Timeout (default 300s)
     - Cron schedule (5-field; the v0.4.0 frequency cap still applies)
     - Secrets (comma-separated uppercase names; invalid ones are ignored with a warning)
     - `mcp: true` opt-in for Claude Desktop exposure
     - `redactSecrets: true` for known-prefix scrubbing of output
  6. **Preview + confirm** — prints the resolved YAML, asks before writing
  7. **Write** — lands in `agents/local/<name>.yaml`, chmod-safe, overwrite-guarded

  Every emitted YAML is validated against `agentDefinitionSchema` _before_ the file is written — if validation fails (shouldn't, given the prompt guards), the command exits 1 without side effects.

  ### Why now

  The security PRs (v0.4.0 → v0.6.1) added fields to the schema that are easy to forget by hand: `mcp`, `allowHighFrequency`, `redactSecrets`. Having the creator land _after_ those PRs means the prompt flow covers the full schema from day one, rather than being retrofitted.

  ### Implementation notes

  - Pure `buildAgentYaml(answers)` function is exported for testing — given an answers object, it emits deterministic, validated YAML with a stable key order (identity → type → execution → scheduling → capabilities).
  - Interactive flow uses `node:readline/promises`, matching the pattern already in `sua tutorial`. No new prompt-library dependency.
  - The command is read-only until the user confirms at the very end, so Ctrl-C at any stage leaves the filesystem untouched.

  ### Tests

  14 new tests in `packages/cli/src/commands/new.test.ts`:

  - YAML round-trips through `yaml.parse` to the expected object (shell + claude-code minimums).
  - Key order is semantic and stable.
  - Optional fields are omitted when not set; `mcp: false` / `redactSecrets: false` don't clutter the output.
  - Shell and claude-code fields don't leak into each other.
  - Every emitted YAML parses AND validates through `agentDefinitionSchema` (parameterized across several answer shapes).
  - Schedules emitted by the creator pass the v0.4.0 cron frequency cap.

  176 total tests pass.

  ### Follow-up (not in this PR)

  The tutorial's "now make your own" stage-6 wrapper — the thing that invokes this verb from inside `sua tutorial` — stays on the roadmap. It's a guided wrapper around this verb, not a new capability; making `sua agent new` a first-class verb means it's reusable outside the tutorial too.

### Patch Changes

- Updated dependencies [51155a4]
  - @some-useful-agents/core@0.7.0

## 0.6.1

### Patch Changes

- 9875ca4: **Fix: community agents are now runnable from the CLI so the v0.6.0 shell gate is actually reachable.** Before this patch, `sua agent run <name>` and `sua schedule start` only loaded `agents/examples/` + `agents/local/` — community agents were visible via `sua agent list --catalog` but "not found" at run time. The shell gate in `executeAgent` was effectively dead code for the primary CLI flow (it still fired for Temporal activities and `executeChain`, both tested).

  Now the runtime commands load from `dirs.all` (runnable + catalog) and the shell gate enforces per-agent opt-in via `--allow-untrusted-shell <name>` exactly as the v0.6.0 docs promised.

  ### Behavior changes

  - `sua agent run <community-agent>` is now accepted at lookup time and refuses at execute time with the expected `UntrustedCommunityShellError` message. Opt in with `--allow-untrusted-shell <name>`.
  - `sua schedule start` will now fire community agents that have a `schedule:` field; the gate still refuses unaudited community shell.
  - `sua mcp start` exposes community agents that have `mcp: true` in their YAML (still filtered by the opt-in flag — no behavior change for agents without it).
  - `sua doctor --security` now counts community shell agents whether or not they've been copied into `agents/local/`.
  - `sua secrets check <name>` now works on community agents.

  ### Unchanged by design

  - `sua agent list` still defaults to `runnable` vs `--catalog` so users can tell their own agents apart from third-party catalog entries.
  - `sua agent audit <name>` already loaded both; unchanged.

  ### Docs

  - `docs/SECURITY.md` and `README` version labels updated from the aspirational `v0.5.1` (what the plan predicted) to `v0.6.0` (what actually shipped). Future passphrase-KEK work renumbered to `v0.7.0`.
  - Version history in SECURITY.md gets a new `v0.6.1` entry documenting the gate wiring fix.

  No API changes. No migration needed.

- Updated dependencies [9875ca4]
  - @some-useful-agents/core@0.6.1

## 0.6.0

### Minor Changes

- d86595f: **Security: community shell agent gate + run-store hygiene + auditing surfaces.** Closes `/cso` findings #5 (shell sandbox — short-term gate) and #7 (run-store hygiene). Third and final wave of the security remediation plan before v0.6.0's passphrase-based secrets KEK.

  ### Behavior changes

  - **Community shell agents refuse to run by default.** `executeAgent` throws `UntrustedCommunityShellError` when an agent with `type: shell` and `source: community` reaches the executor without explicit opt-in. Opt in per-agent (not global) via the new `--allow-untrusted-shell <name>` flag on `sua agent run` and `sua schedule start`. The error message tells the user exactly how to proceed: audit the command, then re-run with the flag. The refusal is recorded in the run store as a failed run so it shows up in history.
  - **Run-store is locked down.** `data/runs.db` is `chmod 0o600` at create time. A startup sweep deletes rows older than `runRetentionDays` (default 30; configure in `sua.config.json` or via the `retentionDays` option on `RunStore`). `Infinity` disables the sweep.
  - **Opt-in secret redaction.** A new `redactSecrets: true` agent YAML field runs captured stdout/stderr through a known-prefix scrubber before the store records it. Targets AWS access key IDs (`AKIA…`), GitHub PATs (`ghp_…`), OpenAI / Anthropic keys (`sk-…` / `sk-ant-…` / `sk-proj-…`), and Slack tokens (`xoxb-`, `xoxp-`, `xapp-`). Intentionally narrow to avoid the false positives that kill generic "value > 20 chars" scrubbers.

  ### New CLI surfaces

  - **`sua agent audit <name>`** — read-only. Prints the resolved YAML with type, source, schedule, `mcp:`, `redactSecrets:`, secrets, envAllowlist, env, dependsOn, and the full `command:` or `prompt:`. Community agents get a loud warning footer explaining the `--allow-untrusted-shell` gate.
  - **`sua doctor --security`** — read-only. Checks chmod 0o600 on the MCP token, secrets store, and run-store DB; confirms the MCP bind host; lists community shell agents that would refuse to run; shows which agents are MCP-exposed. Non-zero exit when any check fails.

  ### API changes (for library consumers)

  - `executeAgent(agent, env, options?)` — new third argument `{ allowUntrustedShell?: ReadonlySet<string> }`. Community shell throws `UntrustedCommunityShellError` when the agent name is not in the set.
  - `LocalProvider` now accepts an options object as its third constructor arg: `{ allowUntrustedShell?, retentionDays? }`. The old two-arg form still works.
  - `TemporalProvider` accepts the same two options and propagates `allowUntrustedShell` through the workflow input so workers inherit the submitter's trust decision.
  - `RunStore` accepts a `{ retentionDays?: number }` options argument. Exposes `sweepExpired(days)` for manual invocation.
  - New exports from `@some-useful-agents/core`: `UntrustedCommunityShellError`, `ExecutionOptions`, `LocalProviderOptions`, `RunStoreOptions`, `DEFAULT_RETENTION_DAYS`, `redactKnownSecrets`.
  - New CLI helper: `createProvider(config, { providerOverride?, allowUntrustedShell? })`. The previous bare-string signature still works.

  ### Migration

  If you write shell agents under `agents/community/`, they will now refuse to run unless the caller passes `--allow-untrusted-shell <name>`. Either move the agent to `agents/local/` (treated as trusted) or audit and opt in per-invocation. Run `sua doctor --security` to see which agents are affected.

  If you want known-prefix redaction for an agent's output, add `redactSecrets: true` to its YAML. Default behavior is unchanged — existing agents keep storing output verbatim.

  `data/runs.db` will now be chmod 0600 and the startup sweep will delete rows older than 30 days. To change the window, add `"runRetentionDays": N` to `sua.config.json`; set it very large to effectively disable.

  Docs: `docs/SECURITY.md` and the README security notes are updated to reflect what shipped vs what remains on the roadmap.

### Patch Changes

- Updated dependencies [d86595f]
  - @some-useful-agents/core@0.6.0

## 0.5.0

### Minor Changes

- 3218194: **Security: chain trust propagation + MCP agent opt-in + threat model docs.** Closes `/cso` finding #4 and the MCP-scope portion of the remediation plan. Two behavior changes, one new default, and a new public doc.

  ### Behavior changes

  - **MCP agents must opt in to be callable.** Only agents with `mcp: true` in their YAML are exposed via the MCP server's `list-agents` and `run-agent` tools. Non-exposed agents respond as "not found" so a compromised client cannot enumerate your full catalog. Existing example YAMLs (`hello-shell`, `hello-claude`, `dad-joke`) ship with `mcp: true` so the tutorial keeps working; new agents scaffolded by `sua init` default to `mcp: false` with a commented hint.
  - **Community agent output flowing through chains is now treated as untrusted.**
    - Claude-code downstream prompts that consume `{{outputs.X.result}}` from a community-sourced X get a `[SECURITY NOTE]` prepended and the value wrapped in `BEGIN/END UNTRUSTED INPUT FROM X (source=community)` delimiters.
    - Shell downstream of a community upstream is **refused outright** with `UntrustedShellChainError`. This blocks the most direct RCE path (community output landing in a shell env var that a careless command could eval). Override via `executeChain`'s new `allowUntrustedShell: Set<agent-name>` option — per-agent, not global.
    - All chains, trusted or not, now receive `SUA_CHAIN_INPUT_TRUST=trusted|untrusted` in the downstream env so shell agents can branch.

  ### New documentation

  - **`docs/SECURITY.md`** — full threat model: intended use, trust rings, layered MCP defenses, chain trust propagation, env filtering, cron cap, supply-chain posture. Equally explicit about what sua does NOT defend against (shell sandbox, secrets-store encryption strength, run-output secrets, Temporal history, remote MCP, DoS) so operators can evaluate fit without reading the code.
  - **README** gains a four-sentence threat-model banner above the Quick start section, and the existing "Security notes" list is rewritten to reflect current reality.

  ### API changes (worth calling out for library consumers)

  - `ChainOutput` (new exported type) — the outputs map value is now `{ result, exitCode, source }`. The resolver uses `source` to decide whether to wrap.
  - `resolveTemplateTagged(template, outputs)` (new) — returns `{ text, upstreamSources: Set<AgentSource> }`.
  - `executeChain(agents, provider, triggeredBy, options)` — fourth argument is now an options object `{ allowUntrustedShell?, pollInterval? }`. The previous positional `pollInterval` signature is replaced. No internal callers exist so this is a clean break; adjust any direct consumers.
  - `UntrustedShellChainError` (new exported error) — thrown before the run starts.

  ### Migration

  If you author YAML agents: add `mcp: true` to any agent you want reachable from Claude Desktop or another MCP client. The CLI commands (`sua agent run`, `sua schedule start`, etc.) are unaffected.

  If you consume `@some-useful-agents/core` as a library: `executeChain`'s fourth arg became an options object, and the outputs map carries `source`. If you were passing a bare number for poll interval, wrap it as `{ pollInterval: n }`.

### Patch Changes

- Updated dependencies [3218194]
  - @some-useful-agents/core@0.5.0

## 0.4.0

### Minor Changes

- dae7022: **Security: transport lockdown.** Closes findings #1, #3, #6, and #8 from the `/cso` audit. This is the first wave of security hardening that lands before the broader community-trial push. Three behavior changes worth noting up front, plus several invisible defenses.

  ### Behavior changes

  - **MCP server now binds to `127.0.0.1` by default.** Previously it bound to all interfaces (Node's default for `listen(port)` with no host), so anyone on the same Wi-Fi could POST to the MCP endpoint and execute any loaded agent with the user's secrets. The console log used to lie about this — it claimed `localhost` while binding everywhere. New `--host` flag on `sua mcp start` for users who genuinely need LAN exposure (prints a warning).
  - **MCP server now requires a bearer token** (`Authorization: Bearer <token>`). `sua init` and `sua mcp start` create a 32-byte token at `~/.sua/mcp-token` (mode 0600) on first run. Existing MCP clients (Claude Desktop, etc.) need to be updated with the new header — `sua mcp start` prints a ready-to-paste config snippet. Use `sua mcp rotate-token` to roll the token; `sua mcp token` prints the current value.
  - **Cron schedules now have a 60-second minimum interval.** node-cron silently accepted 6-field "with-seconds" expressions like `* * * * * *` (every second), which could melt an Anthropic bill. 5-field expressions (the standard) still pass unchanged. The new `allowHighFrequency: true` YAML field bypasses the cap with a loud warning logged on every fire.

  ### Invisible hardening

  - MCP server checks the `Host` header against a loopback allowlist (defense for the `--host` case).
  - MCP server checks the `Origin` header against the same allowlist (defends against DNS rebinding from a browser tab).
  - Each MCP session is pinned to the sha256 of the bearer token used to create it, so `rotate-token` cannot be abused to hijack live sessions.
  - Bearer comparison uses `crypto.timingSafeEqual` to avoid timing leaks.
  - `actions/checkout`, `actions/setup-node`, and `changesets/action` are now SHA-pinned in CI workflows so a compromise of those orgs can't silently ship malicious code through a moving tag. Dependabot opens weekly PRs to refresh the SHAs.
  - New `.github/CODEOWNERS` requires owner review for any change under `.github/workflows/` once the matching ruleset is enabled on `main`.

  ### Migration

  If you are using the MCP server today: after upgrading, run `sua mcp start` once to see the printed config snippet, paste the new `Authorization` header into your client config (Claude Desktop, etc.), and restart your client. If you have YAML agents with 6-field cron schedules, either move them to a 5-field schedule (recommended) or add `allowHighFrequency: true`.

  Audit report and full threat model: see the project's `/cso` workflow.

### Patch Changes

- Updated dependencies [dae7022]
  - @some-useful-agents/core@0.4.0

## 0.3.2

### Patch Changes

- @some-useful-agents/core@0.3.2

## 0.3.1

### Patch Changes

- @some-useful-agents/core@0.3.1

## 0.3.0

### Minor Changes

- 89fd40d: Onboarding walkthrough and local cron scheduler.

  - `sua tutorial`: 5-stage interactive walkthrough that ends with a real scheduled dad-joke agent. Type `explain` at any stage for a Claude or Codex deep-dive.
  - `sua init`: now scaffolds `agents/local/hello.yaml` so `sua agent list` is never empty on first run.
  - `sua schedule start|list|validate`: cron-based scheduler via `node-cron`. Agents with a `schedule` field now actually fire.
  - `sua doctor`: new checks for scheduler readiness, installed LLM CLIs, and scheduled agent validity.
  - New core modules: `LocalScheduler` and `invokeLlm` / `detectLlms` utilities.
  - `dad-joke` example agent in `agents/examples/`.
  - Public `ROADMAP.md` at the repo root.

### Patch Changes

- Updated dependencies [89fd40d]
  - @some-useful-agents/core@0.3.0

## 0.2.0

### Minor Changes

- 3122f3f: Initial public release. Local-first agent playground with YAML agent definitions, CLI (`sua`), MCP server (HTTP/SSE), Temporal provider for durable execution, encrypted secrets store, and env filtering to prevent secret leakage to community agents.

### Patch Changes

- Updated dependencies [3122f3f]
  - @some-useful-agents/core@0.2.0
