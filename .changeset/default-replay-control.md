---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Output widgets now synthesise a default "Run again" control when no replay is declared.

Authoring an output widget previously required adding `controls: [{type: replay}]` in YAML to get a Re-run button on the agent / run detail pages. Most authors forgot, so most widgets shipped without one. The button now synthesises automatically when (a) the renderer is invoked with a `controlState` (i.e. a detail-page render, not Pulse / home / interactive tile), and (b) the schema has no `replay` control declared.

The synthesised control is wired with the agent's declared `inputs[*]` names so the inline form lets users tweak inputs before re-running. Authors who declared a custom replay (with custom label or input subset) keep their config.
