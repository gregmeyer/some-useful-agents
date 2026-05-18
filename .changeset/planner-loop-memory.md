---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Planner refactor PR 3 — cross-run memory.

The planner now reads prior committed plans for similar goals before composing a new one. Implements the `understand` phase of the loop principles: before reaching for the LLM, retrieve what worked last time and pass it as context.

- **`PlannerMemoryStore`** — new SQLite table `planner_memory` (one row per committed plan with goal + tokens + intent + plan_json + attempts).
- **`findSimilarCommittedPlans`** — bag-of-words Jaccard retrieval; intent equality as a hard filter when known. Ranked by similarity DESC then attempts ASC (prefer plans that took fewer planner tries — cheap quality signal). MVP-level; embeddings replace this when N grows.
- **`formatPriorPlansBlock`** — renders top-K candidates as a `<priorPlans>` block (score / attempts / intent / goal / newAgent ids). Compact summary, not full plan JSON.
- **Initial kickoff retrieves by goal only** (intent not yet known); **retries retrieve by goal AND intent** (sharpest signal once classified).
- **Commit hook writes** to memory when the user clicks Commit on the wizard. Only when something actually landed AND telemetry has goal+intent.
- **Build-planner prompt** acknowledges `<priorPlans>` — prefer reuse when patterns match, ignore when they don't.
- **Escape hatch**: `SUA_PLANNER_MEMORY_DISABLED=1` env var skips memory injection without a redeploy.

15 new tests across memory-store, retrieval, and runner. Third of a planned 4-PR refactor.
