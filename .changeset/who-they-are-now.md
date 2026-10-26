---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/dashboard": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
---

When what a notebook found disagrees with who it's about, it says so, and you can settle it.

A new system agent, `notebook-reconciler`, compares a notebook's profile (role, company, where they're based) with what its steps found. It runs after find, source and profile steps, and before talking points are written. Disagreements about the present show at the top of the notebook: the question, and each side with its source and date. **Check it** has sua look it up as of today and keep the sourced answer, and **It's …** keeps the side you know is right. Until it's settled, the talking points state neither side and open with a question that lets them say. Core adds `NotebookAboutOne.conflicts`, `cleanConflicts`, `setAboutConflicts` and `settleConflict`. See ADR-0062.
