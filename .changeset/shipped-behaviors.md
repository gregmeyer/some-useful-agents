---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

The behavior specs ship with sua, and the agents that report facts are held to them.

`cite-evidence-before-claiming` and `declare-blind-spots` now ship inside the package (a new `bundled` behavior scope, trusted like project scope and after it in precedence), so a shipped agent can list them on any install. research-one, notebook-checker, starter-research and agent-analyzer are held to both; firmographic-research to cite-evidence-before-claiming. The same spec found in a checkout and its bundled copy counts once.
