---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

A dashboard restart no longer leaves runs abandoned.

On SIGTERM the dashboard now stops taking requests, then gives in-flight runs and background work up to 10 seconds to finish. It then stops what's still going and records those runs as cancelled ("Stopped because the dashboard shut down.") before closing its databases. Before, the databases closed under running work, and the next boot's reaper marked those runs as abandoned. `sua daemon restart` now waits up to 20 seconds for the old services to exit, instead of starting the new ones 250 ms later, so the new dashboard's reaper only finds real orphans. `sua dashboard start --replace` waits the same way, then SIGKILLs a dashboard still holding the port.
