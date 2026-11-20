# ADR-0092: A chart on paper is the chart's picture

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer
- Builds on: ADR-0089 (VegaChart), ADR-0091 (a page on paper)

## Context

ADR-0091 printed a `VegaChart` in a notebook's brief and PDF as a table of its data, because Vega didn't run on the server. The brief and its PDF are the notebook's output artifact, shared and kept, and they need to show what the page shows: a chart as a chart.

## Decision

**The server draws each chart to SVG with the Vega the browser uses.**
- The vendored bundle (`assets/vendor/a2ui-vega.js`, built by `scripts/vendor-vega.mjs`) gains `vegaToSvg(spec, { config })`: Vega-Lite compiled, a headless view (`renderer: 'none'`), `toSVG()`.
- It is built with the same settings as the browser's drawing: the expression interpreter (no `eval`) and a loader that refuses every fetch. On a server this matters more, since a spec can't make the server fetch anything, internal addresses included.
- No new dependency: one pinned Vega, in one bundle, for the page and the paper.

**Charts are drawn before the brief.** The brief renderer is synchronous and drawing is async. So the brief and PDF routes call `briefChartPictures(nb, entries, history)` first (`lib/brief-charts.ts`). It reads each chart's spec with the page's bindings and functions (ADR-0091's evaluator), draws it on paper colours (light, the brief's palette), and hands `renderPageBrief` a map of component id to picture.

**A picture is an image.** Each SVG is kept as a `data:image/svg+xml` URI in an `<img>`. An SVG used as an image runs no scripts and loads nothing, and it embeds in a saved file and in the PDF.

**The table stays as the fallback.** A chart that can't be drawn (a bad spec, a Vega error) prints its data as a table, as in ADR-0091.

## Consequences

- The PDF and the saved brief show charts as charts, the same marks and data as the page, in the brief's light palette.
- Vega (about 840 KB) is loaded by the server the first time a brief with a chart is made, and kept.
- A brief with charts takes a little longer to make, one headless draw per chart (tens of milliseconds each).
