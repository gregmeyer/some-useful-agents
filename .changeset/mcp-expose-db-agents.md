---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

fix(mcp): expose dashboard-managed (v2) agents alongside filesystem (v1) agents

`list-agents` only ever returned a single agent because the MCP server
reads agents from filesystem YAML directories (`loadAgents`). Every
dashboard-managed agent lives in the SQLite agent store (DB), not on
disk, so they were all invisible to MCP regardless of their `mcp:
true` flag.

This PR makes the MCP server consult both sources:

- **AgentStore (v2, DB)** is the canonical source for dashboard-managed
  agents. Filter: `mcp = true` AND `status = active`.
- **Filesystem (v1, legacy)** still works for pre-DB YAML files. DB
  entries win on id collision.
- `loadMcpExposedAgents` now takes an options bag (`{ agentStore,
  agentDirs }`) and returns a discriminated `McpAgentEntry` so the
  `run-agent` tool can dispatch v2 agents through `executeAgentDag`
  and v1 agents through the existing `provider.submitRun` path.
- `startMcpServer` opens dedicated `AgentStore` + `RunStore` +
  `VariablesStore` handles against the same SQLite DB (safe under
  WAL, same pattern the dashboard + scheduler already use).
- `list-agents` JSON output gains a `source: "v2" | "v1"` field so
  callers can distinguish dashboard-managed from filesystem-loaded.

The `run-agent` tool now successfully starts v2 agents from MCP. Run
results come back synchronously (v1 path) or wait for the DAG
executor to complete and return the run summary (v2 path).
