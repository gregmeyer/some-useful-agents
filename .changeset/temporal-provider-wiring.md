---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Dashboard and MCP server honor the configured run provider.

`sua dashboard start` and `sua mcp start` now accept `--provider <local|temporal>`
(also respecting `SUA_PROVIDER` and `sua.config.json`) and route "Run now" /
run-submission through that provider instead of always using the local one. The
selected provider is shown in the startup banner, and an unreachable Temporal
server fails fast with a clear hint instead of hanging. New operator guide at
`docs/temporal.md` covers running Temporal in Docker and monitoring it via the
Temporal Web UI.

Note: this routes v1 single-node agents through Temporal; multi-node (v2 DAG)
agents still run in-process. Executing v2 DAGs on Temporal is planned next.
