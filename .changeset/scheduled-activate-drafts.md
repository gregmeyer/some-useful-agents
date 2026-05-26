---
"@some-useful-agents/core": patch
"@some-useful-agents/cli": patch
"@some-useful-agents/mcp-server": patch
"@some-useful-agents/temporal-provider": patch
"@some-useful-agents/dashboard": patch
---

dashboard/scheduled: Activate one-click on draft rows + explanatory hint for non-firing statuses.

Follow-up to the new /scheduled page. The page listed drafts with a `schedule:` declared but offered no row action — leaving the user with `Every day at 7:00 AM` next to `—` in Next fire and a "why didn't this run?" question. The answer is that the scheduler only fires `status='active'` agents.

Now:

- **Draft rows get an `Activate` button.** Posts to a new `POST /scheduled/:id/activate` route that flips status `draft → active`. Same shape as Pause/Resume; 303 redirect with a flash; idempotent guards.

- **Non-active rows get an explanatory Next-fire hint.** Drafts render `won't fire — status is draft` (with a tooltip explaining the scheduler-only-fires-active rule). Archived render `won't fire — archived`. Paused continues to show `—` (the cron is paused-by-intent and one click away from firing on Resume).

- **`never` in Last fire gets a tooltip.** Clarifies that the column counts only scheduler-triggered runs — manual runs via dashboard / CLI / MCP don't count, so an agent that's been run manually but never by the scheduler shows `never` here by design.

Tests: 1614 pass / 3 skipped (+4 new: draft renders Activate + hint, activate flips status, idempotent on already-active, archived hint with no row action).
