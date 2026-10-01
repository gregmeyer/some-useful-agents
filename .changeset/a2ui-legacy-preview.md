---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Existing widgets are converted to A2UI views.

A converter turns agents' existing Pulse templates and output widgets into A2UI views, so they draw through the same renderer as agent `view:`s, with the same values: the old slot mapping, field extraction and ai-template substitution run on the server and the view only lays them out. Threshold and accent colours carry over to metrics, and headings use the dashboard's monospace font. See "Widgets are drawn with A2UI by default" for how it's switched on.
