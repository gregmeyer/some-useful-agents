---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix dashboard hanging on SIGTERM/SIGINT.

The dashboard's graceful shutdown called `server.close()`, which only stops
accepting new connections and waits for existing ones to drain. The inbox SSE
stream and the 2s poll keep-alives never close on their own, so shutdown hung
forever and the process became a zombie squatting on the port — surfacing as
recurring "dashboard crashed on startup" (EADDRINUSE) errors. Shutdown now
pairs `server.close()` with `server.closeAllConnections()` (Node 18.2+) to
force-terminate the lingering sockets, so the dashboard stops promptly.
