---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

fix(inbox): Stop now cancels an in-flight action that hasn't registered a runId

Stop could silently no-op on a running sub-agent action ("Stop didn't
respond"). The dispatch only wrote its runId onto the action card at
finalize, so for the whole time an action was `running` its meta carried no
runId — and the Stop route's `!m.runId` guard skipped it, never aborting the
run and leaving the modal's pending spinner stuck.

The dispatch now persists the runId onto the action card the instant the run
starts (both local and Temporal backends), so Stop can reach the live run and
abort it. As a belt-and-suspenders, Stop also finalizes any running action
that still has no runId directly to a terminal state, so the card can never
hang in `running`.
