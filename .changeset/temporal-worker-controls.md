---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Manage the Temporal worker as a first-class service.

The Temporal worker is now a managed `sua daemon` service: add `worker` to
`daemon.services` or run `sua daemon start --service worker`. When
`provider: temporal` is configured, `sua daemon start` also passes
`--provider temporal` to the dashboard + MCP server so the whole stack agrees.
New `scripts/temporal-up.sh` / `temporal-down.sh` bring the entire stack
(Temporal server + dashboard + MCP + worker) up and down in one command.

A new **Settings → Temporal** page shows the active run provider, the Temporal
connection (address / namespace / task queue), and the worker's status with
Start / Stop controls (managing the same daemon-tracked worker — the worker
still runs on the host, never inside the web process).
