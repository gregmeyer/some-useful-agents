---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua calls or builds a helper before it rewrites an agent.

When an agent can't do part of its job, sua now works down a ladder: run an installed agent that already does it, have the fixer add a step that calls one, build a small helper and wire it in on one card, and only then edit the agent's prompts or steps (when its own job is broken). A notebook step that stalls on facts its agent can't find follows the same order.
