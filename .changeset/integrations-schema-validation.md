---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Schema-aware save-time template validation (PR 4.C of Integrations).

Catches typos in `{{upstream.<node>.<path>}}` references at agent save
time instead of resolving silently to "" at run time. `ToolOutputField`
now carries optional `items` / `properties`, and the CSV / Postgres
generated tools populate per-row column schemas from their snapshots —
so `{{upstream.fetch.rows.0.emial}}` fails save in the dashboard YAML
editor with "Property 'emial' not found … Did you mean 'email'?".

The validator is lenient: when a tool's output schema doesn't declare
`items` / `properties` (legacy user tools, untyped built-ins), the
walker stops without reporting. Field paths are only flagged when the
schema is rich enough to disprove them.

`parseAgent()` keeps its single-argument signature — the new
`validateAgentTemplatePaths(agent, { resolveTool })` is opt-in and
runs from the dashboard's YAML save handler, which already has the
integrations + tool registries in scope.
