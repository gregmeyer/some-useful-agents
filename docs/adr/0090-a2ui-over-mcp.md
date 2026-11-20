# ADR-0090: A notebook as an A2UI page over MCP

- Status: accepted
- Date: 2026-11-20
- Deciders: Greg Meyer

## Context

sua's MCP server gives a notebook to a client as text or JSON (`notebook-read`). A2UI 1.0 defines how an MCP server serves interfaces:
- the layout is a resource at an `a2ui://` URI, of type `application/a2ui+json`;
- a tool's result carries the data as an embedded `updateDataModel` message;
- the result's `_meta.ui.resourceUri` names the layout.

A host that draws A2UI shows that as a page. Other hosts keep the text.

The dashboard draws a notebook's page with sua's own catalog and data built in the dashboard. An MCP host has neither: it has A2UI's basic catalog.

## Decision

**A compact notebook page in basic components only** (core `a2ui/notebook-surface.ts`):
- the title, what it's for, and where it stands (the answer and its confidence, the plan, the decision, or how many are in the running);
- what it rests on (findings, plan items or talking points);
- up to 10 options in the running, with their first facts;
- what's still open, and the done-whens.

Every value is bound to the data. An empty section's heading is empty, so it draws as nothing.

**The MCP server:**
- registers `a2ui://notebook` (the layout: `createSurface` and `updateComponents`, A2UI 1.0, basic catalog);
- has `notebook-read`, for one notebook read whole, add an embedded resource (`application/a2ui+json`) carrying that notebook's `updateDataModel`, with `_meta.ui` naming the layout.

The text is unchanged and comes first.

**Fixed in passing:** `notebook-tldr` checks a takeaway's numbers against the notebook's text. That text included its notes' timestamps, so a note filed at 19:45 let "45%" through as one of the notebook's numbers. The timestamps are now left out.

## Consequences

- An MCP host that draws A2UI shows a notebook as a page, not a block of text. Claude Desktop and others show the text as before.
- The page is simpler than the dashboard's: no sua components, charts or pictures. That's the price of drawing anywhere.
- A test runs the layout and a notebook's data through A2UI's strict processor with the basic catalog alone.
- Not done: other tools (an agent run's view, a board) as surfaces, and renderer capability negotiation. When a host advertises sua's catalog, it could get the full page.
