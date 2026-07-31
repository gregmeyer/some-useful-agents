---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(inbox): global SSE stream — live badge + live list without reload

The inbox now pushes changes to every open page instead of waiting on a 30s
poll. A new global `'*'` channel on the inbox event bus carries coarse
`inbox:changed` events, published at every state-change site (thread created,
triaged, verifying, resolved, dismissed, reopened, run-failure raised). A new
`GET /inbox/events` SSE endpoint streams them; a single `EventSource` per tab
re-broadcasts them so the top-bar "needs you" badge updates within ~half a
second and the `/inbox` list live-refreshes its rows (via a new
`GET /inbox/rows` fragment) with the operator's current filters preserved. The
30s poll remains as a fallback. Live refresh yields to an open thread modal or
an in-progress bulk selection so it never yanks work out from under you.
