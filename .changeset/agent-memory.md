---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Agents can remember things between runs (`memory: true`).

An agent with `memory:` on starts each run with its pinned notes plus the ones most relevant to the run's inputs, and its llm and goal nodes get `memory-save`, `memory-search` and `memory-forget` tools, scoped to that agent. Declared secret values are redacted before a note is saved. See and edit what an agent remembers on its Overview page (Memory section) or with `sua memory list|search|pin|forget`. Works on Temporal workers too. See docs/memory.md.
