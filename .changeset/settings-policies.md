---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Settings → Policies: see the tool policy in force and test whether a call would be allowed.

The new tab shows the policy file, its default action and its rules in order, and warns in red when the file is invalid (which blocks every tool call). "Would this be allowed?" takes a tool, a resource and the agent's source and answers Allowed or Blocked, highlighting the rule that decided, the same answer as `sua policy check`. "Blocked by policy rule #N" in the goal node's tools picker links to it.
