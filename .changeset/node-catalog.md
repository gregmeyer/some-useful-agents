---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Node catalog API + dashboard page.

Hand-authored typed contract for every first-class node type (`shell`, `claude-code`, `conditional`, `switch`, `loop`, `agent-invoke`, `branch`, `end`, `break`). Each contract has a description, full inputs and outputs lists, "use when" guidance, and a copy-pasteable example.

- `NODE_CATALOG` + `listNodeContracts()` + `getNodeContract()` exported from `@some-useful-agents/core`.
- Dashboard routes: `GET /api/nodes` (full catalog as JSON), `GET /api/nodes/:type` (single entry), `GET /nodes` (browseable HTML page).
- New "Nodes" entry in the top nav between Tools and Runs.

The planner-fronted agent-builder (PR A) will query `/api/nodes` during its discover step so the LLM works from the actual node-type contract instead of guessing or inventing names like `file-write` or `template`. The page is also useful for humans browsing what's available.

Forcing function: a test asserts every `NodeType` has a catalog entry — adding a new node type without documenting it fails the test.
