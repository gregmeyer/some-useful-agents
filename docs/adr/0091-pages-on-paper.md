# ADR-0091: A notebook's page on paper keeps up with its A2UI

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

A notebook's brief, and the PDF made from it, prints the notebook's page with a printer of its own (`views/notebook-page-brief.ts`). It doesn't use the A2UI renderer: a saved file and a PDF carry no scripts. The printer read a value only as a literal or a `{ path }` binding, and printed only the components it knew.

The page grew past that:
- function calls (ADR-0087), such as `formatString`, `join`, `count`, `formatRange` and `relativeTime`;
- agent functions (ADR-0088): a search table's rows come from `findOptions`;
- the 1.0 binding form `{"@path"}` (ADR-0084);
- `VegaChart` (ADR-0089).

On paper these printed nothing.

## Decision

**A value evaluator for printing** (`lib/a2ui-print-values.ts`) works a value out the way the renderer does:
- a literal stays as it is;
- a binding in either form is read from the data;
- a function call runs: `formatString` with `${/path}` and `${fn(arg:${/path})}`, worked out innermost first; `formatNumber`, `formatCurrency`, `formatDate`, `pluralize`; and sua's `join`, `count`, `formatRange` and `relativeTime`;
- an agent function answers from the notebook being printed, through `agentFunctionValue`, the same code the dashboard's endpoint uses.

sua's three formatting helpers are ported to TypeScript, and a test checks they say the same as the browser's.

**A VegaChart prints as its data:** a table under the chart's title, with columns named by its encoding. Bindings inside the spec are read first. Vega doesn't run on the server.

## Consequences

- A brief and its PDF say what the page says: counts, ranges, joined lists and "3 days ago" in its words, and a search table's rows as the search with its starting words finds them.
- On paper a chart is its numbers, not its picture. Drawing it would mean running Vega (and a DOM or a headless render) on the server; that is a later choice, if wanted.
- Two copies of three small formatting helpers, one in the browser and one on the server, kept equal by a test.
