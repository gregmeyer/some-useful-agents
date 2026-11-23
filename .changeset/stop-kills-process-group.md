---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Stopping a node stops everything it started, and a stopped run ends cancelled.

A shell node runs `sh -c '<command>'`. Cancel used to SIGTERM only the `sh`, so a long command it had started kept running and held the node open until it finished on its own. Each node process now runs in its own process group, and Cancel, a timeout, the dashboard's shutdown and the boot reaper stop the whole group. SIGKILL now follows after 5 seconds when something in the group ignored SIGTERM; before, the check looked at whether the signal was sent, so it never fired. Ctrl+C on `sua agent run` still stops the node's processes. A run stopped this way is recorded as `cancelled` with the reason ("Cancelled by user.", or "Stopped because the dashboard shut down."), not as `failed` with a timeout, so it no longer opens a failure thread in the inbox.
