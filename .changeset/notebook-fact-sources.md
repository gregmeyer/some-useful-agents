---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A notebook's facts can say where they came from, and which are estimates.

An option's fact can carry its source and an estimate flag (agents give `{"value", "source", "estimate"}`). The keeper adds them when a run's output says where a figure came from or that it's approximate. The shortlist marks estimates with "≈" and links sourced facts. A later search that states the fact again replaces or clears them. The option's link button uses its field's label ("Website" for companies).
