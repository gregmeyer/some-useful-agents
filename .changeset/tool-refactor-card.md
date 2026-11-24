---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A card that points several agents at a shared tool, all or nothing.

The inbox can now carry a `tool-refactor-apply` card: a new tool (or one of yours) and an edit for each agent that then calls it. Approving checks everything first (the tool as `sua tool add` would; each agent not changed since, using only tools that exist or this one, giving back the same outputs), then saves the tool and each agent as a new version, and undoes them all if a save fails. The agent-editor card's checks moved to a shared module (no change in what it accepts). sua starts proposing this card in a following release.
