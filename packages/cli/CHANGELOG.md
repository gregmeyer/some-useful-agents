# @some-useful-agents/cli

## 0.16.0

### Minor Changes

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

- 6c25718: **feat: global variables store + `sua vars` CLI (Variables PR 1 of 6).**

  Adds a plain-text global variables store at `.sua/variables.json` for non-sensitive project-wide values (API_BASE_URL, REGION, DEFAULT_TIMEOUT). Variables are visible to every agent at run time — executor wiring comes in PR 2.

  - **`VariablesStore`** in core — JSON-backed CRUD with `get/set/delete/list/getAll`. Creates the `.sua/` directory on first write.
  - **`sua vars list/get/set/delete`** CLI — mirrors the secrets CLI pattern. `set` warns when a name looks sensitive (TOKEN, KEY, PASS, SECRET) and suggests using `sua secrets set` instead.
  - **`looksLikeSensitive()`** helper — flags names that probably belong in the encrypted store.

### Patch Changes

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

- Updated dependencies
- Updated dependencies
- Updated dependencies [170dd4c]
- Updated dependencies [d0ec3fc]
- Updated dependencies [663af58]
- Updated dependencies [0f002da]
- Updated dependencies [96e5add]
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
- Updated dependencies [9a5af08]
- Updated dependencies [21cc114]
- Updated dependencies [6c25718]
- Updated dependencies [ffa2986]
  - @some-useful-agents/core@0.16.0
  - @some-useful-agents/dashboard@0.16.0
  - @some-useful-agents/mcp-server@0.16.0
  - @some-useful-agents/temporal-provider@0.16.0

## 0.15.0

### Minor Changes

- 89571b6: **fix: `sua workflow import` fails hard on YAML parse errors by default.**

  Before: a single unparseable YAML file (bad shell quoting, invalid escape, schema violation) would silently drop that agent from the migration, printing a warning but continuing. When downstream agents used `dependsOn:` to reference the dropped agent, the chain silently broke — `post` would land as a single-node DAG instead of being merged into the `fetch → summarize → post` chain. Silent data loss on migration day is the worst possible shape.

  Now:

  - `sua workflow import` (with or without `--apply`) separates directory-level noise (missing optional `agents/examples/`) from file-level errors on actual YAML files
  - File-level errors ABORT the migration with a clear list of which files failed and why
  - `--allow-broken` opts into the old behavior (proceed anyway, drop the broken files) for users who know what they're skipping

  ```bash
  sua workflow import --apply
  # If any YAML file fails to parse:
  #   ❌  3 YAML file(s) failed to load. These agents would be silently dropped
  #       from the migration, which usually breaks dependsOn chains ...
  #     ✖ agents/local/summarize.yaml
  #         Invalid YAML: Invalid escape sequence \{ at line 3, column 87
  #   → exit 1
  ```

  No changes to the successful-migration path. Users with clean YAML see the same output they did before.

  Prompted by a real incident during v0.14 bring-up where a `"\{print ...}"` double-quoted shell command inside YAML silently broke a three-node chain.

### Patch Changes

- Updated dependencies [628b742]
- Updated dependencies [b210ec1]
  - @some-useful-agents/dashboard@0.15.0
  - @some-useful-agents/core@0.15.0
  - @some-useful-agents/mcp-server@0.15.0
  - @some-useful-agents/temporal-provider@0.15.0

## 0.14.0

### Minor Changes

- 31fd09f: **feat: v1 → v2 migration + `sua workflow` CLI + replay-from-node (PR 4 of 5 for agents-as-DAGs).**

  This PR wires everything from PRs 1–3 together into user-facing functionality. Users can now import their v1 YAML chains, see the merged DAGs, run them, inspect per-node logs, and replay from a specific node — all via the new `sua workflow` command tree.

  ### Migration (`agent-migration.ts` in core)

  - `planMigration(inputs)` — pure function, no filesystem reads; takes the v1 agent set, builds transitive `dependsOn` closures, emits one DAG-agent per connected component. Idempotent.
  - `applyMigration(plan, store)` — upserts into `AgentStore` with `createdBy: 'import'`. Leaf of the component becomes the DAG's id. `{{outputs.X.result}}` rewritten to `{{upstream.X.result}}`. `.yaml.disabled` files (v0.11's paused state) map to `status: 'paused'`.
  - Defensive rejections: mixed-source components (e.g. local depending on community) refused with a clear warning; fan-out components with multiple leaves emit an advisory and pick the alpha-first leaf; missing `dependsOn` targets flagged.
  - 14 new tests covering isolated agents, linear chains, diamonds, fan-outs, mixed-source refusal, template rewrite, idempotent re-runs, version bumps on DAG changes, commit-message preservation.

  ### `sua workflow` CLI command tree

  | Verb                                                          | What it does                                              |
  | ------------------------------------------------------------- | --------------------------------------------------------- |
  | `import [dir] [--apply]`                                      | Dry-run by default; `--apply` commits migration to the DB |
  | `list [--status <s>] [--source <s>]`                          | Table of imported DAG agents                              |
  | `show <id> [--format yaml]`                                   | Text DAG view or full YAML export                         |
  | `run <id> [--input KEY=value] [--allow-untrusted-shell <id>]` | Execute synchronously via DAG executor                    |
  | `status <id> <status>`                                        | active / paused / archived / draft                        |
  | `logs <runId> [--node <id>] [--category <cat>]`               | Per-node execution table with category filter             |
  | `replay <runId> --from <nodeId>`                              | Re-run from the pivot, reusing stored upstream outputs    |
  | `export <id>`                                                 | Emit YAML to stdout (round-trips with `import-yaml`)      |
  | `import-yaml <file>`                                          | Ingest a v2 YAML file directly (bypasses v1 migration)    |

  Run id prefixes work for `logs`/`replay`. Every command shares a single `DatabaseSync` connection via `AgentStore.fromHandle` + `RunStore.fromHandle`.

  ### Replay-from-node (new executor mode)

  `executeAgentDag(agent, { replayFrom: { priorRunId, fromNodeId } })`:

  - Copies prior `node_executions` rows for every node before the pivot in topological order, preserving their `result`, `started_at`, and `completed_at`. The audit trail makes clear these are historical, not fresh.
  - Seeds the executor's outputs map with copied results, so the pivot node sees exactly the upstream snapshot the original run produced.
  - Re-executes the pivot and all downstream nodes fresh.
  - `runs.replayed_from_run_id` + `replayed_from_node_id` populated for the UI breadcrumb.
  - Refuses the replay if the pivot isn't in the agent or if any pre-pivot node in the prior run lacks a completed result — fail-fast setup-category error rather than running the pivot with empty upstream.

  4 new replay tests: copy behavior, upstream snapshot preservation at pivot, pivot-not-in-agent refusal, missing-prior-outputs refusal.

  ### Tests

  18 new (14 migration + 4 replay). 394 → 412 repo-wide.

  ### What's NOT in this PR (landing in PR 4b before PR 5)

  - `LocalProvider.submitDagRun` — today `sua workflow run` calls the DAG executor directly. MCP and scheduler still dispatch to v1 agents via `LocalProvider.submitRun`. PR 4b adds dispatch so all three triggers (CLI, MCP, cron) route through the same DAG executor.
  - Removal of `chain-executor.ts` — stays alive until the LocalProvider swap is complete.
  - `@deprecated` markers on v1 `AgentDefinition` — paired with the swap.

  Dashboard DAG visualisation is PR 5.

  ### Manual verification

  ```bash
  cd /tmp && mkdir play && cd play
  sua init
  cat > agents/local/fetch.yaml <<EOF
  name: fetch
  type: shell
  command: "echo headlines"
  source: local
  EOF
  cat > agents/local/summarize.yaml <<EOF
  name: summarize
  type: shell
  command: "echo got=\$UPSTREAM_FETCH_RESULT"
  source: local
  dependsOn: [fetch]
  EOF
  sua workflow import --apply         # merges into one DAG named 'summarize'
  sua workflow list                   # shows fetch + summarize as a 2-node DAG
  sua workflow show summarize         # DAG topology as text
  sua workflow run summarize          # runs fetch → summarize; output: got=headlines
  sua workflow logs <runId>           # per-node table with categorised errors
  sua workflow replay <runId> --from summarize   # re-runs summarize with fetch's stored output
  sua workflow export summarize       # emits YAML
  sua workflow status summarize paused
  ```

### Patch Changes

- Updated dependencies [f7c0689]
- Updated dependencies [b7c73aa]
- Updated dependencies [31fd09f]
  - @some-useful-agents/core@0.14.0
  - @some-useful-agents/dashboard@0.14.0
  - @some-useful-agents/mcp-server@0.14.0
  - @some-useful-agents/temporal-provider@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [e8b3079]
- Updated dependencies [0e21b19]
  - @some-useful-agents/core@0.13.0
  - @some-useful-agents/mcp-server@0.13.0
  - @some-useful-agents/temporal-provider@0.13.0
  - @some-useful-agents/dashboard@0.13.0

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
  - @some-useful-agents/mcp-server@0.12.0
  - @some-useful-agents/dashboard@0.12.0
  - @some-useful-agents/temporal-provider@0.12.0

## 0.11.0

### Minor Changes

- a21055c: **feat: agent lifecycle verbs — `edit`, `disable`, `enable`, `list --disabled`.** A set of small commands for the day-to-day "I want to tweak this agent without memorizing paths, or pause it without losing the YAML" flows.

  ### `sua agent edit <name>` — open the YAML in $EDITOR Resolves the agent name to its source file, spawns `$EDITOR`(or`$VISUAL`, falling back to `vi`on Unix /`notepad`on Windows), then re-parses and validates on save. Validation errors name the offending field and the file path so you can jump back and fix without waiting for`sua agent run` to surface the problem.

  ```bash
  sua agent edit hello                       # open in $EDITOR
  sua agent edit hello --print-path          # just print the resolved path
  code "$(sua agent edit hello --print-path)"   # hand the path to VS Code
  ```

  Under the hood, `AgentDefinition.filePath` is now populated by the loader (runtime-only metadata, not part of the on-disk schema) so `audit`, `doctor`, and any future `agent edit`-adjacent verbs have a single source of truth for "where did this agent come from." Non-TTY invocations print the path to stdout instead of spawning an editor — lets you compose with other tools without interactive state.

  When the named agent isn't found but there's a matching file on disk that the loader skipped (invalid YAML, failed schema check), the error now names those files and their loader warnings so broken edits don't silently disappear from `sua agent list`.

  ### `sua agent disable <name>` / `sua agent enable <name>` — pause without deleting

  ```bash
  sua agent disable claude-test    # renames to claude-test.yaml.disabled → loader skips it
  sua agent list --disabled        # see what's paused
  sua agent enable claude-test     # rename back
  ```

  The loader already ignores anything that isn't `.yaml` / `.yml`, so the `.disabled` suffix is the only state change — no schema fields, no hidden files. Examples (bundled) agents refuse to disable; community agents refuse by default with `--force` to override. Disabling a scheduled agent prints a reminder to restart any running `sua schedule start` daemon so it drops the in-memory cron job.

  `enable` matches on the YAML's declared `name:` field rather than the filename, so renaming the file independently of the agent name still works. Conflicts (disabling when `.disabled` already exists, enabling when a new `.yaml` has claimed the slot) refuse with a clear "resolve manually" message rather than clobbering either file.

### Patch Changes

- ad651db: **fix: don't open the secrets store for agents that declare no secrets.**

  v0.10.0 regression: `LocalProvider.submitRun` and `runAgentActivity` both called `secretsStore.getAll()` unconditionally for every run, which meant any agent — even one with no `secrets:` field — needed the store to be unlockable. On a v2 passphrase-protected store that turned every run into "set SUA_SECRETS_PASSPHRASE or nothing works", which was never the intent.

  Now the store is only opened when the agent actually declares secrets. Regression test in `local-provider.test.ts` uses a store that throws on any read and asserts the provider never touches it for an agent with no `secrets:` field.

- Updated dependencies [a21055c]
- Updated dependencies [ad651db]
  - @some-useful-agents/core@0.11.0
  - @some-useful-agents/temporal-provider@0.11.0
  - @some-useful-agents/mcp-server@0.11.0

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
  - @some-useful-agents/mcp-server@0.10.0
  - @some-useful-agents/temporal-provider@0.10.0

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
  - @some-useful-agents/mcp-server@0.9.0
  - @some-useful-agents/temporal-provider@0.9.0

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
  - @some-useful-agents/mcp-server@0.8.0
  - @some-useful-agents/temporal-provider@0.8.0

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
  - @some-useful-agents/mcp-server@0.7.0
  - @some-useful-agents/temporal-provider@0.7.0

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
  - @some-useful-agents/mcp-server@0.6.1
  - @some-useful-agents/temporal-provider@0.6.1

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
  - @some-useful-agents/mcp-server@0.6.0
  - @some-useful-agents/temporal-provider@0.6.0

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
  - @some-useful-agents/mcp-server@0.5.0
  - @some-useful-agents/temporal-provider@0.5.0

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
  - @some-useful-agents/mcp-server@0.4.0
  - @some-useful-agents/temporal-provider@0.4.0

## 0.3.2

### Patch Changes

- b3fd569: Three small but visible improvements:

  1. **Suppress the `node:sqlite` ExperimentalWarning.** Every `sua` command was printing `(node:XXXX) ExperimentalWarning: SQLite is an experimental feature...` because we use the built-in `node:sqlite` module. The CLI now filters that specific warning while letting every other warning through. When the minimum Node version eventually moves to 24+, where sqlite is stable, this becomes a no-op.

  2. **Rewrite the README.** Reflects the v0.3 command surface (including `sua tutorial`, `sua schedule`, `sua secrets`), shows a real agent YAML with chaining + scheduling + secrets, notes known-weak security spots with links to ADRs, and points at the ROADMAP + ADR dir.

  3. **Expand ROADMAP.md.** Added daemon mode / unattended operation, tutorial resume, parallel agents / swarms, and a formal security audit as explicit "Next" items.

  - @some-useful-agents/core@0.3.2
  - @some-useful-agents/mcp-server@0.3.2
  - @some-useful-agents/temporal-provider@0.3.2

## 0.3.1

### Patch Changes

- c671954: Fix tutorial silently exiting after stage 3. ora's default `discardStdin: true` was fighting with readline: after the spinner stopped, stdin was left in a state that made subsequent `rl.question` calls fail silently, so the tutorial never reached stages 4 and 5. All ora calls in the tutorial now pass `discardStdin: false`. Also wraps each stage in a try/catch that logs errors before re-throwing, so future silent failures are visible.
  - @some-useful-agents/core@0.3.1
  - @some-useful-agents/mcp-server@0.3.1
  - @some-useful-agents/temporal-provider@0.3.1

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
  - @some-useful-agents/mcp-server@0.3.0
  - @some-useful-agents/temporal-provider@0.3.0

## 0.2.0

### Minor Changes

- 3122f3f: Initial public release. Local-first agent playground with YAML agent definitions, CLI (`sua`), MCP server (HTTP/SSE), Temporal provider for durable execution, encrypted secrets store, and env filtering to prevent secret leakage to community agents.

### Patch Changes

- Updated dependencies [3122f3f]
  - @some-useful-agents/core@0.2.0
  - @some-useful-agents/mcp-server@0.2.0
  - @some-useful-agents/temporal-provider@0.2.0
