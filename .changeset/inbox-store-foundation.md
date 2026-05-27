---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox store foundation — SQLite-backed queue for "needs your attention".

First of a 5-PR sequence (this is the MVP base; the dashboard UI lands
in PR 2). Adds `InboxStore` in core with:

- `inbox_messages` table keyed by id, with priority (high/medium/low),
  source (run-failure / permission-request / cadence / manual),
  status (open → triaged → awaiting_user → verifying → resolved, plus
  `dismissed` as terminal), and a `dedupe_key` UNIQUE column so
  producers can fire-and-forget without state
- `inbox_responses` table for per-message conversation threads
  (role: user / triage / system), used by later PRs
- Public API: `add`, `list`, `get`, `findByDedupeKey`, `updateStatus`,
  `dismiss`, `addResponse`, `listResponses`, `clear` — mirrors the
  canonical pattern from `BlockedImgHostsStore` / `LayoutHintsStore`

`list()` default-orders by priority (high first via CASE expression,
since alphabetical sort would put low before medium) then created_at
DESC, and default-excludes `dismissed` and `resolved` so the queue
shows only active work.

Producers, dashboard UI, top-nav entry, triage system agent, CLI verbs,
and verification loop all ship in follow-up PRs. The schema is locked
now (including unused-in-MVP columns like `triage_run_id` and
`recommendation`) to avoid migrations.
