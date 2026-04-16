---
"@some-useful-agents/core": minor
---

**feat: executor tool dispatch + output framing (PR 2 of 6 for v0.16).**

Wires the tool abstraction from PR 1 into the DAG executor so nodes with `tool:` actually run. Adds an output framing protocol for extracting structured JSON from shell tool stdout.

### What ships

- **Executor tool dispatch** — when a node has `tool:` set, the executor resolves it from the built-in registry (or the `ToolStore` for user-defined tools) and calls the tool's `execute()` function directly. Built-in tools run in-process; user tools with shell/claude-code implementations go through the existing `spawnProcess` path with a synthetic node shape derived from the tool's definition.
- **Output framing** (`output-framing.ts`) — extracts the last JSON-parseable line from stdout as structured output. Shell tools that `printf '{"status":200}'` on their last line get automatic structured output capture. Plain-text stdout (v0.15 style) falls back to `{ result: stdout }`.
- **`outputsJson` stored** — every completed node now writes its structured output to `node_executions.outputsJson` (the column PR 1 added). Both tool-dispatched and legacy-spawned nodes populate it.
- **`ToolStore` on `DagExecutorDeps`** — optional; when present, the executor resolves user-defined tools from it. When absent, only built-in tools are available.
- **v0.15 nodes unchanged** — nodes without `tool:` go through the existing spawn path. No backcompat desugaring at exec time; opt-in only.

### Design notes

- Built-in tool `exit_code` is extracted from the `ToolOutput` object (tools return it as a field). Legacy spawns use the process exit code as before.
- The executor tries framed-output extraction even on legacy nodes — if a v0.15 shell script happens to emit a JSON last line, it'll be captured. No harm if it doesn't.
- Template resolver v2 (path-based `{{upstream.X.body.items[0]}}`) is deferred to PR 3 — this PR gets tools running; the next PR makes their outputs addressable.

### Tests

517 total (508 → 517; +9 new):
- `output-framing.test.ts` — 9 tests: JSON object/array extraction, trailing empty lines, non-JSON fallback, empty stdout, single-line JSON, `buildToolOutput` framed vs plain.
- All 508 existing tests pass unchanged.
