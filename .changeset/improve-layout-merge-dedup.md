---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

Fix duplicate-container overlap in the dashboard layout after repeated Improve-layout runs:

- **Merge instead of duplicate**: `mergePlanWithDraftedAgents` now reuses an existing "Newly drafted" container if one is in the plan (carried over from a prior session by the planner). Previously it always appended a new one, producing two sections with the same label that overlapped visually.
- **applyPlan dedupes by label**: the wizard's localStorage writeback now collapses any duplicate-label containers (case-insensitive) before saving, so even a plan that slips through with duplicates resolves into one section with the union of tiles.
- **Server-side commit dedupes too**: `/dashboards/:id/layout-plan/commit` now merges duplicate-title sections before writing `dashboard.layout.sections`. Defensive — keeps the persisted layout clean regardless of what the client sent.
