---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Inbox: triage can now summon an agent's widget into a thread.

Activates the show-widget mechanism. The triage AGENT_CATALOG now carries a `hasWidget` flag
(true when an agent has an inline output widget), and the triage kernel teaches when to propose
`show-widget` ("show me X's output" → display the latest run read-only) vs `run-agent` ("run/refresh
X" → execute). Dogfooded live: asking "show me the <agent> output" surfaces that agent's latest
output widget inline as a card, with no re-run and no extra triage turn.
