---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Make `startMcpServer().shutdown()` use `httpServer.closeAllConnections()` instead of per-session `McpServer.close()`.

#225 added a `shutdown()` handle so tests could stop the listening http server, which fixed the EADDRINUSE flake. But the `for entry of sessions: await entry.server.close?.()` loop raced SDK transport teardown against the next test's first request, surfacing as a different flake: `TypeError: fetch failed — SocketError: other side closed`. The Release workflow tripped this on the post-#225 main push.

Conservative fix: drop the per-session McpServer close, just `httpServer.closeAllConnections()` + drain provider + await `httpServer.close()`. Releases the port without poking at SDK internals. 10/10 stress runs of the file pass locally.
