---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(inbox): list pagination, source/agent filters, source sort, bulk resolve

The inbox list no longer silently caps at 200 rows. A "Load more" control
pages through the rest (append-only, preserving the current filters), backed
by a new `listPage()` store method that reports `hasMore` via a limit+1 probe.
The filter bar gains Source and Agent dropdowns, and the previously-dead
`?sort=source` key now really sorts by source. A "Resolve selected" bulk action
sits alongside the existing bulk dismiss. Operator bulk resolve stays out of
the Home loop ticker (it isn't an autonomous close).
