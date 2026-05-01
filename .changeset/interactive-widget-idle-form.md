---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Interactive widgets: form is always visible alongside the result.

Magic-8-ball-style Pulse tiles now render the inputs form below the last result in idle, so re-running with a tweaked prompt is one edit + one click instead of two clicks through a separate "Ask again" pane. Form fields pre-fill with the most recent run's input values rather than the agent's declared defaults. The state machine collapses to idle / running / stuck / error.
