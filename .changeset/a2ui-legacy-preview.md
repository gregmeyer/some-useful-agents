---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Preview: draw existing widgets with the A2UI renderer.

Settings → Appearance has a new "Widget renderer (preview)" switch that draws agents' existing Pulse templates and output widgets through the A2UI renderer agent views use, with the same values (the old extraction runs on the server; threshold and accent colours carry over). Metric, text-headline, status, comparison, key-value, story and table templates, and key-value, raw, dashboard and ai-template widgets convert today; charts, images, media, funnels, interactive forms and sort/filter controls keep the current renderer. Off by default.
