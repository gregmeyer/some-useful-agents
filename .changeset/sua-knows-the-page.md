---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

sua knows which page you asked from, so "this dashboard" means that dashboard.

A new conversation started from the sua drawer or the top bar now carries the page you're on: a dashboard, an agent, a notebook, a run, or Home. "Fix this dashboard" works on the dashboard you were looking at, not Home. On an agent's page, the conversation is about that agent. A Home change proposed from another page is refused unless you said Home or Today.
