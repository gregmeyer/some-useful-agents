---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Composition correctness — `agent-invoke` and `loop` now share one input-mapping resolver, and loop items expose parsed structured outputs.

Two correctness fixes that block clean composed agents (the "wizard → orchestrator → result widget" pattern the build-planner v3 catalog promotes):

1. `agent-invoke` `inputMapping` now substitutes `{{inputs.X}}` (forwarding the parent agent's inputs to the sub-run) and accepts `$upstream.<id>.<field>` and `$item.<path>` for symmetry with `loop`. Previously only `upstream.<id>.<field>` worked, so a literal `{{inputs.TOPIC}}` would be passed verbatim to the sub-agent.

2. `loop` results expose `items[]` as **parsed structured outputs** when the sub-agent's result was a JSON object — so a downstream summariser prompt can dot-walk via `{{upstream.<loop>.items.0.<field>}}` instead of having to parse JSON-encoded strings out of an array of strings. Plain-text sub-agent results still come through as raw strings; failed sub-runs are still `null`.

Both change paths share one resolver (`resolveSourceExpr`), so future composition node types stay consistent.
