# ADR-0089: VegaChart

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

sua's charts are its own small components: Sparkline, Bars, Scatter and DayBars. They are easy for a model to fill and styled to match. An agent that needed any other chart had nothing to draw it with: a stacked bar, a layered line, a heatmap, a facet.

A2UI publishes a `vegachart` catalog. It has one component, `VegaChart`, with props `spec` (a Vega-Lite spec) and `height`, rendered with vega-embed.

Vega is large, about 840 KB minified with Vega-Lite. By default its expressions use `new Function`, which the dashboard's CSP (no `unsafe-eval`) refuses. A spec can also ask to load data, images or links from anywhere.

## Decision

**`VegaChart` is a sua component** with A2UI's props: `spec`, and an optional `height`. A surface written for A2UI's `vegachart` catalog draws from sua's, because the normaliser drops its `@catalogId`. Mixing the official catalog in would mean loading Vega on the server to validate it. This way is the same component, validated like the rest.

**Vega loads only when a page draws one.** `scripts/vendor-vega.mjs` pins vega 6.4.0, vega-lite 6.5.0, vega-embed 7.3.0 and vega-interpreter 2.3.2, and bundles them into `assets/vendor/a2ui-vega.js`. The component imports it on first use.

**It draws safely.**
- Expressions run through `vega-interpreter` (`ast: true`), so there is no `eval`.
- The loader refuses every request, so a chart shows only the data its spec carries. An outside URL draws as an empty frame, with the refusal in the console.
- The page's CSP (`connect-src 'self'`) stands behind this anyway.

**Data in the spec can be bound.** A `{"@path"}` object inside the spec (`data.values: {"path": "/notebook/options"}`) is read from the surface's data through its signal while the component renders. So a page can chart what it has, and the chart redraws when that data changes.

**Colours come from the page's tokens**, read when it draws: the accent for marks, the border for gridlines, muted text for labels.

The chat-reply guide leaves it out to keep that prompt small. The agent-view and notebook-page guides list it with the other components.

## Consequences

- Agents and the page designer can draw any chart Vega-Lite can describe.
- Checked in a browser: a bar chart bound to page data drew 3 bars in the page's colours. A spec asking for an outside URL fetched nothing.
- 840 KB more to download, only on a page with a VegaChart, once.
- The prompt budget for building agents grew by 100 characters.
