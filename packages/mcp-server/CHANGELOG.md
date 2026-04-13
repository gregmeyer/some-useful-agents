# @some-useful-agents/mcp-server

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
