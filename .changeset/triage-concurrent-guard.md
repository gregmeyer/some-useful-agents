---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard): concurrent-triage guard — one in-flight turn per thread + don't auto-fire on pending actions

Plan item #4 from
`~/.claude/plans/triage-followups-2026-05-30.md`. Two races closed:

**(a) Two triage runs racing on the same thread.** When triage was
already running and an operator reply arrived (or a sibling tab hit
`/triage`), `runTriageAgent` happily started a second run. Two replies
would land out-of-order; message-status updates raced.

`runTriageAgent` now checks `ctx.inboxTriageAbortControllers.has(messageId)`
at the top and defers re-entry by adding the message to a new
`ctx.inboxTriagePendingRefires` Set. The in-flight run's `finally`
block drains the pending refire via `setImmediate` after clearing
its own controller — so the operator's reply still gets a triage
turn, just sequential instead of concurrent. The drain is gated on
`!signal.aborted` so operator-cancelled runs don't auto-restart.

**(b) Triage auto-firing while a proposed action is pending.** When
triage proposed an action and the operator replied before the action
ran, `POST /inbox/:id/respond` would auto-fire triage anyway —
triage would then propose ANOTHER action or comment on the pending
one. The action also might auto-approve and run concurrently with
the fresh triage turn.

`POST /respond` now skips the auto-fire when any action on the
thread is in `proposed` or `running` state. The user reply is still
recorded; the post-action `maybeRefireTriage` (which fires when all
actions resolve) gives triage the full picture in one turn instead
of two. Operator can still hit "Ask triage" explicitly to force a
turn.

**Set membership is idempotent** — N stacked re-entries collapse to
one queued refire. The in-flight run only sees CONVERSATION as of
its start time, so the queued refire ensures every reply gets a
response.

Tests: 4 new route tests cover (a)+(b). Full suite: 1839 passing.
