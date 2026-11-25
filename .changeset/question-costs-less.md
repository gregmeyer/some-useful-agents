---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

A question costs less: the best few checked, searches sized to the need, a per-question budget, cheaper workers.

- **Check and source steps** with no top of their own work on your pick plus 2 (at least 5), not every option found.
- **A find try** makes about one search per two options still needed (2 to 5).
- **A question has a budget** (Settings → Usage, $8 by default). Once its steps have spent it, sua starts no new try and doesn't start its next step by itself; a write-up still runs.
- **sua's worker nodes** (searches, research, page look, page, tags, pictures) pin `model: sonnet`. A pinned Claude short name now applies only on Claude, and other providers run it on their own model (ADR-0104).
- **Pictures** wait until a question's steps stop, and the page isn't drawn again after the first step when a write-up will draw it anyway.
- **New in core:** `SpendLimits.perQuestionUsd`, `perQuestionBudget`, `RunStore.spendOfRuns` (each run counted once, with what it called) and `isClaudeAlias`.
