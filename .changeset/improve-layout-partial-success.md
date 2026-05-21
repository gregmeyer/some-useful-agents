---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Improve-layout drafting now handles partial failures with a partial-success screen instead of treating any failure as all-or-nothing.

Before: if 1 of 2 drafts failed, the wizard surfaced an error screen with only **Close** (lose the successful draft) or **Retry with feedback** (re-run everything including the one that already worked). Confusing.

Now: when SOME drafts succeed and SOME fail, the wizard shows a partial-success screen listing each draft with its status (✓ / ✗), inline error for failed ones, plus three actions:

- **Apply N drafts + layout** (primary) — commit just the successful ones and apply the layout.
- **Retry all failed** — re-fire `/agents/draft-one` for every failed entry, leaving successes intact.
- **Retry** (per-row) — re-fire one failed entry individually.

All-failed (existing error screen) and all-succeeded (straight-through to commit) paths are unchanged.
