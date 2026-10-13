---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A View editor with a live preview, starting from what the agent actually outputs.

Settings → Where it shows → **View** opens `/agents/<id>/view`: the agent's A2UI view as YAML, checked and drawn with its last run as you type, saved as a new version (or removed, back to the output widget). An agent without a view gets a starter built from its last run's outputs: metrics with a trend line, labelled facts, tables with linked addresses, chips, paragraphs. The page lists every path the view can bind to with its value, and the sua components with examples. A step that printed JSON as its `result` now exposes that JSON's fields as outputs too (`/outputs/articles`), so views bind fields instead of text.
