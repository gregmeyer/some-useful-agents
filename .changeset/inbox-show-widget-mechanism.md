---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox: summon an agent's latest output widget into a thread (mechanism).

First slice of "widgets in threads". Adds a `show-widget` action mode: instead of running an
agent, it renders that agent's LATEST COMPLETED run's output widget inline in the conversation
(read-only, no dispatch). New `InboxActionMeta.mode` field; `parseProposedActions` accepts
`type: 'show-widget'`; a `resolveShowWidgetAction` resolver points the action at the latest
completed run and auto-resolves `proposed → completed` (the existing inline-widget render path
then displays it), or fails clearly ("no completed run yet — run it first"). The card drops the
run chrome (duration, badge, raw preview) and reads "Latest <agent> output". Guarded against the
dedup-block and refire-loop edge cases. Dormant until the triage kernel teaches it (next slice).
