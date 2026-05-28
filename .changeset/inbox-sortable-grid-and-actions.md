---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: single sortable grid + dismiss + reply.

Dogfood feedback on the MVP (#381): the three priority-grouped tables
fragment the view and source isn't visible enough.

- `/inbox` is now one sortable table with columns Priority / Source /
  Agent / Title / Age / Status. Click any header to sort; the active
  column shows ↑/↓. Default sort is Priority asc (high first) with
  age desc tiebreaker.
- Priority + Source each render as colored badges so the eye picks
  out high-pri and run-failure rows at a glance (`badge--warn` for
  high + run-failure, `badge--info` for medium + permission,
  `badge--muted` for low + cadence/manual).
- Detail page gains two actions:
  - `POST /inbox/:id/dismiss` — terminal-state the message, redirect
    with an `ok` flash. Idempotent.
  - `POST /inbox/:id/respond` — append a `user`-role entry to the
    conversation thread (8 KB cap). The Conversation card now
    shows the reply form inline.
- Terminal-state messages (dismissed/resolved) hide both action
  affordances and show a "closed N ago" hint instead.

Source-specific actions (allow-host for permission-request, retry-run
for run-failure, etc.) and the triage agent that auto-replies to the
thread ship in follow-up PRs.
