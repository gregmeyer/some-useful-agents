---
"@some-useful-agents/core": minor
---

**feat: tool abstraction foundation — types, schema, store, 9 built-in tools (PR 1 of 6 for v0.16).**

Introduces the **tool** as a named, reusable unit of work a node invokes by reference. Nodes gain `tool` + `toolInputs` fields; the executor will resolve tool refs and dispatch via the built-in registry or user-defined tools (wired in PR 2). This PR lays the data layer only — no runtime dispatch yet.

### What ships

- **`tool-types.ts`** — `ToolDefinition`, `ToolOutput`, `BuiltinToolEntry`, `BuiltinToolContext`, `ToolSource`, `ToolFieldType`, `ToolInputField`, `ToolOutputField`, `ToolImplementation`.
- **`tool-schema.ts`** — Zod validation for tool YAML (id, name, source, inputs/outputs with typed fields, implementation with type-specific requirements).
- **`tool-store.ts`** — SQLite `tools` table with CRUD (create, get, list, update, upsert, delete). Mirrors agent-store's `DatabaseSync` + `ensureSchema()` pattern.
- **`builtin-tools.ts`** — registry of 9 built-in tools: `shell-exec`, `claude-code`, `http-get`, `http-post`, `file-read`, `file-write`, `json-parse`, `json-path`, `template`. Each has a `ToolDefinition` (schema) + a Node-native `execute()` function.
- **`AgentNode.tool`** + **`AgentNode.toolInputs`** — optional fields on the v2 node type. When `tool` is set, the node schema doesn't require inline `command`/`prompt` (the tool provides them). `type` stays required for backwards compat — the YAML parser derives it from the tool's implementation at load time.
- **`NodeExecutionRecord.outputsJson`** — new column on `node_executions` for structured tool outputs. Idempotent `ALTER TABLE ADD COLUMN` migration on first open.
- **`NodeStructuredOutput`** type + `NodeOutput.outputs` field for in-memory structured output passing between nodes.
- **Variable defaults confirmed** — `AgentInputSpec.default` + `description` already exist in types, Zod schema, and executor resolve. The UI surface (agent detail sidebar) is the remaining task.

### Tests

508 total (484 → 508; +24 new):
- `tool-schema.test.ts` — 7 tests: valid shell/claude-code/builtin tools, invalid id, missing required fields, typed inputs/outputs round-trip.
- `tool-store.test.ts` — 7 tests: create, get, list (sorted), update, upsert, delete, nonexistent lookups.
- `builtin-tools.test.ts` — 10 tests: registry lists all 9 tools, retrieval by id, isBuiltinTool checks, shell-exec executes a command, json-parse/json-path/template/file-read exercise the execute functions.
