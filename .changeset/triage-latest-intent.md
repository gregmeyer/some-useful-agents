---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix triage reverting to an earlier goal when the operator pivots mid-thread.

Inbox triage was anchored to the original message body (`MESSAGE_BODY`), which
is frozen at thread creation. When the operator changed their mind partway
through a thread, triage kept pursuing the first request and, on auto-follow-up
turns, re-proposed stale actions (including ones that had already failed),
ignoring the newer ask. Triage now receives the operator's latest message as a
first-class `CURRENT_REQUEST` input that takes precedence over the frozen
original, and the inbox-triage prompt no longer re-proposes failed actions the
current request has moved past.
