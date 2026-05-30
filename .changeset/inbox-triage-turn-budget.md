---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

feat(dashboard): cap consecutive auto-triage turns at 5

Closes the runaway-loop risk Layer 2 introduced. The existing
`maybeRefireTriage` (which already re-invokes triage after each
sub-agent action resolves) now counts consecutive `triage` responses
since the most recent `user` reply. When that count hits 5, instead of
firing another triage turn we post a system note ("Auto-follow-up
paused after 5 consecutive triage turns. Reply or dismiss to continue."),
flip the thread to `awaiting_user`, and stop. The operator's next
reply resets the counter so fresh user input always gets a fresh
budget.

Layer 3 of the triage follow-through plan
(`~/.claude/plans/triage-follow-through.md`). The other half of Layer 3
— passing sub-agent results to the follow-up triage turn — was already
in place: `runTriageAgent`'s CONVERSATION snapshot includes each action's
status and `resultSummary` (lines 1319-1328), so triage already sees
what came back without any new input plumbing.

Closes the "did you finish?" pain end-to-end:
- Layer 1 (#411) — triage emits structured commitments; chip surfaces
  pending work in the modal header.
- Layer 2 (#412) — trusted sub-agent proposals auto-approve to running.
- Layer 3 (this) — sub-agent completion re-invokes triage to summarize,
  capped at 5 turns to prevent runaways.
