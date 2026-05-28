---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

LLM fallback policy: when the primary provider fails with a
recognized credit/quota/binary-missing/timeout error, node-spawner
automatically retries the same prompt under a configured fallback
provider. Operators configure both providers from a new
`/settings/llm` page that also includes a Probe button for liveness
checks and a "last fallback fired" status line.

- New `LlmSettingsStore` (file-backed JSON at
  `data/.sua/llm-settings.json`) — `{ primary, fallback?, lastFallback? }`
- New `classifyLlmFailure(SpawnResult)` buckets failures into
  `credit_exhausted | quota_exceeded | binary_missing | timeout |
  rate_limited | auth_required | other`. Only the first four trigger
  a fallback; rate limits stay on the primary (transient), auth
  failures bubble up (operator action required), `other` is treated
  as a real bug we don't want to mask.
- `spawnNodeReal` accepts an `llmSettings` snapshot in opts and
  retries with the fallback provider when applicable. The snapshot
  carries an `onFallback` callback that records telemetry back to
  the store so the settings page can show "fallback fired 3m ago on
  agent X because credit_exhausted."
- `DagExecutorDeps.llmSettings` threads the snapshot through; every
  dashboard `executeAgentDag` call site (inbox, run-now, build,
  layout planners, widget-run, run-mutations) is wired up.
- New `/settings/llm` route + view with primary/fallback dropdowns,
  Save button, Probe button (spawns each CLI with `--version`,
  reports reachable/failed inline), and a status panel for last
  fallback telemetry. New "LLM" tab in the settings shell nav.

19 new tests covering store CRUD + the failure classifier.
