---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A2UI preview covers interactive widgets, charts, images, media and funnels.

With Settings → Appearance → "Widget renderer (preview)" on, interactive widgets now draw as an A2UI form (the agent's inputs as text fields and choice chips, pre-filled from the last run) with a Run button that runs the agent and refreshes the tile in place. The time-series, funnel, image, text-image and media templates convert too, using two new catalog components, Sparkline and Funnel. 25 of 26 example Pulse templates and 18 of 22 output widgets now convert; what's left uses widget controls. A Button action named `run-agent` ({agent, in_<INPUT>}) runs an agent from any A2UI view outside chat.
