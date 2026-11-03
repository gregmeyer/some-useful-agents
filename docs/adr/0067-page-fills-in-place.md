# ADR-0067: The page fills in place

- Status: accepted
- Date: 2026-11-03
- Deciders: Greg Meyer
- Builds on: ADR-0056 (layouts as documents), ADR-0064 (a page composed from what was written), ADR-0066 (what-if diagrams)

## Context

A notebook page polls for a fresh copy of its main column every five seconds and replaced the column's HTML whenever the notebook changed. Every A2UI surface in it was torn down and mounted again: the page jumped, scroll and focus could move, and a what-if slider snapped to its written value until the browser's stored value was read back. Empty parts were pruned from a drawn page, so while the find and write steps ran, a composed page showed only what existed so far and its shape appeared piece by piece. A Claude artifact fills in where it stands.

## Decision

1. **Data in place when the parts match.** The client keeps each mounted surface's message processor and the JSON of its component list. On a refresh it parses the new column; when the column's shell (everything but the surfaces' insides) and every surface's component list are the same as what's mounted, it sends only the `updateDataModel` messages to the existing processors. Any difference (a part came or went, the shape changed, a surface couldn't take the update) falls back to replacing the column as before. No new route: the same HTML response carries the messages. The page also no longer reloads itself every six seconds while something runs; the working panel in the header is redrawn in place on that cadence instead, and a step starting or ending still reloads once (the steps key).
2. **Skeletons while a step runs.** `resolveNotebookLayout` takes `pending`; with it, a Panel that would be pruned as empty is kept with `pending: true` and its subtree drawn with it, so rows keep their widths. The Panel element draws its title over three grey rules in place of its child, with no motion. The dashboard passes `pending` only while a pipeline or step is running, and only on pages where empty parts are pruned (not the shortlist). The leftovers AnswerSections (`rest`) never holds a place. The brief never prints a pending part.

## Consequences

- A page updates the way a document does: words and numbers change where they are. The what-if state in a Figure survives because the element does.
- A model never sets `pending`; it is page state, like `skip`.
- Fill in place depends on the component list being stable between polls. Parts that change with data (a `when` flag flipping, a part pruned once a step ends) still redraw the column; that is one redraw per such change, not one per poll.
