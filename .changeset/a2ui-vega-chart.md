---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents and notebook pages can draw any chart (VegaChart).

A new `VegaChart` component draws any Vega-Lite chart (stacked bars, layered lines, heatmaps, facets) from data in its spec or bound to the page's data. It is the same component as A2UI's vegachart catalog. Vega loads only on a page that draws one, runs safely under the dashboard's content security policy (no `eval`), and never fetches anything, so a chart shows only the data it's given.
