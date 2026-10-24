# ADR-0056: A notebook's layout is an A2UI document

- Status: accepted
- Date: 2026-10-24
- Deciders: Greg Meyer
- Builds on: ADR-0047 (A2UI views)

## Context

Every notebook's page was the same: where it stands, a price-by-measure map, a funnel, a ranked
shortlist, a "before you decide" checklist, the timeline and coverage. That fits choosing among
many options (a car, a job, accounts to call). It doesn't fit other outcomes. A notebook preparing
for a meeting wants who the person is, their company, what they've written and what to talk about;
a notebook answering a question wants the answer and its evidence. Its "themes" showed up as
shortlist cards ranked like used cars.

The layout was one function (`notebookWidgetComponents`). Adding an outcome meant more code paths
in it, and neither the user nor sua could draw a page that fit.

## Decision

1. **A layout is an A2UI document** (`packages/core/src/notebook-layout.ts`): the catalog's
   components, bound to the notebook's data (`/notebook/...`), with a `root`. Any component can be
   placed, so a page can be drawn to fit what the notebook is for. Agents' views and boards use the
   same catalog.
2. **Two notebook extensions, resolved when the page is drawn**, so one document fits many
   notebooks:
   - `when: "<flag>"` (or `"!<flag>"`) on a component: drawn only when the notebook has it
     (`map`, `funnel`, `steps`, `options`, `decided`). A part left out leaves its parent; a
     Columns loses its width, and a container left empty goes.
   - `{ "path": "/notebook/layout/<key>" }` as a value: a setting derived from the notebook (the
     map's labels, the shortlist's sort, filters, CSV link). Components whose props take only plain
     values can still follow the notebook.
3. **Checked on the way in.** `setLayout` resolves a layout as a notebook with everything would
   draw it and runs the A2UI validator (the catalog's components and props, one root, nothing
   dangling). A bad layout is refused with the validator's reasons.
4. **Presets are documents.** `NOTEBOOK_LAYOUT_PRESETS` starts with `shortlist`, the old page,
   whose output is byte for byte what the old function drew. A notebook keeps its own
   `layout_json`; none means the default. Templates carry their notebook's layout.
5. **New outcomes are new documents** plus any components the catalog lacks: a briefing (a person
   or company, what they care about, an agenda) and a report (an answer with its evidence) are
   next. sua chooses a preset when it drafts a notebook and can draw or rearrange one on request.

## Consequences

- Existing notebooks are unchanged: they have no layout and draw the shortlist.
- What a page can show is bounded by the catalog, not by notebook code. A widget a new outcome needs
  is added to the catalog once and is usable by notebooks, boards and agents' views.
- The data under `/notebook/...` is now an interface: renaming a path breaks stored layouts.
  Paths are added, not renamed.
