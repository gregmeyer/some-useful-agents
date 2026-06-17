---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage: confirm one side-effecting action before firing the next.

When triage would propose several mutations in a single turn (e.g. "make a note
AND set a reminder"), it now proposes only the first. Each proposed action
declares an `effect` (`read` or `write`); the route keeps at most one `write`
card per turn and holds the rest, surfacing a neutral "holding N more…" note.
Once the operator runs the first write and it completes, the follow-up triage
turn re-plans and proposes the next from the updated state. Read-only actions
(catalog search, run analysis, list probes) still batch freely.
