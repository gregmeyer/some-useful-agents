---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix inbox thread not updating when triage finishes with an error.

Several triage completion branches ("did not complete", "no <plan>", "malformed
JSON") added a system message to the conversation without emitting the
`message:created` SSE event, so an open thread didn't refresh and the operator
had to reload the page to see it. All triage system messages now route through a
helper that always publishes the event, so the thread updates live.
