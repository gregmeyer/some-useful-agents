---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

`startMcpServer` now returns a `{ shutdown }` handle so callers (tests, CLI, embedders) can stop the listening http server cleanly.

Pre-fix it returned `void`, leaving callers no way to drain the server. Two MCP test describe blocks ran random-port servers per test and never shut them down — across CI runs the random-port pool occasionally collided and a fresh test ended up talking to a prior test's still-running server (whose agentDir had been rm'd), surfacing as flaky `Agent "..." not found`. The planner-telemetry PR (#224) added enough test load to shift ordering and trip the latent flake reliably.

`shutdown()` closes all live MCP transports, drains the provider, and awaits `httpServer.close()`. Also tightened the initial `listen()` to await the bind and surface listen errors instead of fire-and-forget.
