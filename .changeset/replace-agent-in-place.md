---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Ask sua to fix an agent, and approve the fix before it's applied.

**Ask sua to fix this** on an agent's page opens a conversation in the panel where sua looks at why the agent isn't working and drafts a fix, shown as a diff you approve. An agent whose failure thread reaches three failures gets the same offer on its own. Fixes always wait for your approval (they no longer apply automatically under Full autonomy), are saved as a new version under the same id, keep the agent's status and schedule, and are refused if the agent changed after the fix was drafted.
