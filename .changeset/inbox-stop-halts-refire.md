---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox: Stop now halts the autonomous triage chain, not just one turn.

The triage Stop/Cancel button only aborted the in-flight triage LLM run, but the
runaway loop is driven by auto-approved actions (agent-analyzer → agent-editor)
completing and refiring triage — so a fresh turn respawned right after Stop and
the thread ran until the consecutive-turn cap. Cancel now sets a per-message stop
flag that `maybeRefireTriage` and the auto-approve dispatch both honor, so the
chain halts after the in-flight action; the flag is cleared when the operator
replies. Stop also takes effect when the thing running is a sub-agent action
(no triage run to abort), posting an acknowledgement note.
