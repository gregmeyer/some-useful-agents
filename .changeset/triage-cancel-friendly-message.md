---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

fix(dashboard): triage stop button no longer double-posts an unfriendly "did not complete" note

Race after PR #425: the cancel route posted "Triage stopped by
operator." and force-finalized the run, but `runTriageAgent`'s
continuation kept running and saw the executor's terminal status
(either `'failed'` or `'cancelled'` depending on who won the race to
update the row). It then added a second, scary system message like
`Triage agent did not complete (failed). Failed at node "triage"
(timeout)`. Operator saw two messages back-to-back, the second
implying something broke when nothing did.

`runTriageAgent` now short-circuits both the continuation AND the
catch-block whenever `abortController.signal.aborted` is set — that
bit is the load-bearing operator-intent signal regardless of which
status the run row ended up at. Also added a defensive
`run?.status === 'cancelled'` check for the rare case where a
sibling tab hit `POST /runs/:id/cancel` while triage was waiting.

The cancel-route system message was also reworded from "Triage
stopped by operator." to "Triage agent cancelled." per the
operator's preference.
