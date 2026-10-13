---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents that compose: sua calls or builds a helper before it rewrites an agent.

See [docs/agents-as-tools.md](https://github.com/gregmeyer/some-useful-agents/blob/main/docs/agents-as-tools.md) and ADR-0051.

- A fix from sua can call one of your agents instead of rewriting the agent it fixes, or build a helper agent and wire it in, on one card.
- An agent's page says which agents it calls and which call it, at the top.
- Agents that call other agents stop cleanly on a loop or a too-deep chain.
- A fix sua makes from a notebook becomes a copy, so it doesn't change an agent other notebooks use.
