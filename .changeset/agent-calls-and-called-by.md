---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

An agent's page says which agents it calls and which agents call it, at the top.

The Overview opens with one line, "Calls … · Called by …", linking each agent and tagging it `draft` or `paused` when it won't run on its own and `helper` when it was built as one. In the diagram, a step that calls another agent names it on a second line. Connections now says "Calls" and "Called by", shows the first sentence of what each agent does, and reminds you that a change to this agent changes what its callers get.
