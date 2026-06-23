---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox: stop triage from rendering an output widget twice in a thread.

After triage ran an agent in a thread, the follow-up triage turn would
often propose a `show-widget` action pointing at that same just-completed
run — but the run-agent card already renders that run's widget inline, so
the widget appeared twice. The engine now declines a `show-widget` whose
latest completed run is already shown inline on the thread
(`showWidgetWouldDuplicate`), and the triage kernel teaches not to
show-widget an agent it just ran in the same thread.
