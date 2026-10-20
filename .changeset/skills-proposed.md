---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

sua proposes skills when it builds or fixes an agent.

When the know-how a build or fix needs would help other agents too, agent-builder and agent-analyzer propose a skill (new, or a change to one the agent lists) with it. It shows on the same card as the agent, under "New skill" or "Changes skill", and one approval saves both. Saved skills keep every version (roll back any time); changing a shipped skill saves your copy, which wins over the shipped file. A skill changed since it was proposed, or an agent listing a skill that doesn't exist, refuses the card with nothing saved. Builders and the analyzer now see every skill in their catalog, so built agents list existing skills instead of copying them. `sua skill list` shows saved skills too.
