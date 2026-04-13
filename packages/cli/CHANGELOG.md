# @some-useful-agents/cli

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
