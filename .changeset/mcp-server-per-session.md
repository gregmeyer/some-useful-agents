---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

mcp-server: fix crash on the second client connection.

The MCP server reused a single `McpServer` instance across all sessions and called `server.connect(transport)` on it once per new session. The MCP SDK requires a fresh server per transport — the second connect threw `Already connected to a transport`, surfaced as an unhandled HTTP-parser exception, and crashed the process. Symptom: `claude mcp list` (or any second client) reported `Failed to connect` and `daemon status` showed the MCP service as `stale (pid dead)`. Now each session gets its own `McpServer`; `provider` and `agentDirs` are still shared. Closing the session also closes its server.
