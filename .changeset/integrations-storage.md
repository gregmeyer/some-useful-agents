---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Settings → Integrations (PR 1 of 4): storage + UI for slack/webhook/file

Adds the `integrations` SQLite table + `IntegrationsStore` (core),
context wiring (dashboard), and a real `/settings/integrations` page
that replaces the "coming in a later release" placeholder. Today
covers three kinds — `slack`, `webhook`, `file` — lifted from the
per-agent notify handlers so the model carries over unchanged.

Each integration row stores names only: kind-specific config (URL,
path, channel, mention, method) and `secretRefs` pointing at the
encrypted secrets store. Actual secret values never touch the
integrations table.

Per-agent notify still reads its existing inline handlers; PR 2 of
this series adds the `handlers[].integration: <id>` form so agents
can reference these by id. PR 3 adds OAuth (loopback callback + Gmail
kind). PR 4 folds the connectors-v0.17 plan in as `kind: csv` /
`kind: postgres`.

Includes 8 store tests (round-trip, slug validation, list-by-kind /
by-user / pack ownership, cascade-delete, JSON corruption fallback)
and 5 dashboard route tests (render, add, slug rejection, duplicate
guard, delete). Pack-owned integrations show but their Delete button
is disabled — pack uninstall remains the path to remove them.
