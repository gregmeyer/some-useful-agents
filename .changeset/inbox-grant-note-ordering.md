---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox: fix the "Enable & run" grant note reading as if the run is still pending.

The approve-to-run grant note said "Granted X… Running it now…", but it's posted
after the action card (proposed earlier), so it renders below the already-finished
run result. "Running it now…" then misled both the operator and the follow-up
triage turn ("the run was just started, wait for the result") even when the run
had already completed or failed. The note now states only the durable fact —
"Enabled X to run from inbox threads — revoke in its Config tab" — and the action
card remains the source of truth for the run's outcome.
