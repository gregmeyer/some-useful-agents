---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

InboxStore: sortable list + derived last-activity timestamp.

Foundation for the inbox queue UX pass (PR 1 of 2). Adds:

**`ListMessagesOpts.sort` + `dir`.** New `InboxSortKey` union
(`priority` | `status` | `age` | `title` | `agent`) and
`InboxSortDir` (`asc` | `desc`). Default sort stays
priority-then-last-activity-desc so existing callers see no
behavior change.

**`InboxMessage.lastActivityAt?: number`.** Derived at `list()`
time via a correlated `MAX(inbox_responses.created_at)` subquery,
falling back to the message's `created_at` when no replies
exist. Drives the queue's "Age" column under default sort and
the explicit `?sort=age` case. `get()` and other single-row
reads leave it undefined (no join cost on the hot path).

**ORDER BY composition** via `buildOrderBy(sort, dir)`. All sorts
tie-break by last-activity desc so results are stable when the
primary key has duplicates. Starred messages float to the top
regardless of sort. `agent` sort puts unagented rows last
regardless of direction so they don't crowd the head of the
list. Unknown keys fall back to priority semantics.

Adds 9 new store tests covering: lastActivityAt derivation +
fallback, default sort (priority desc + activity bump), `age`
sort both directions, `status` sort with "Your turn" first,
`title` sort case-insensitive, `agent` sort with nulls-last,
starred-pinning, unknown-key fallback. 1873 total tests pass
(+10 — 9 new + 1 from the existing dashboard tests picking up
the lastActivityAt field).

PR 2 wires the route + view to honor the new sort knobs, drops
the priority-group cards, adds the sticky sortable header, and
rebuilds the expanded preview as an activity strip.
