---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

dashboard: new /scheduled page + Pause/Resume per row + widget surfaces paused agents.

The home "Scheduled" widget filtered out paused agents — an agent with `schedule: "0 * * * *"` and `status: paused` was invisible even though the schedule is still on record and one click away from firing again. That hid scheduled-but-quiet agents from the user and made it hard to find what to stop.

This release adds a dedicated `/scheduled` page under the Agents tab strip listing every agent with a schedule, regardless of status. Each row carries a one-click **Pause** (active rows) or **Resume** (paused rows) form; both POST to dedicated `/scheduled/:id/pause` and `/scheduled/:id/resume` routes that flip status and redirect back to the list. Schedule cron stays declared either way — pause is reversible. Permanent removal (clearing the cron) still lives on `/agents/:id/config`.

The home widget is updated alongside: it now includes paused agents (badged), shows the same inline Pause/Resume button per row, and links "View all →" to the new page.

Note: this PR does not yet wire pause/resume on the agent loop runner or planner-loop runs — only the per-agent `agents.status` field. The scheduler already honors that field (only `status='active'` agents fire), so the user-visible behavior is correct.
