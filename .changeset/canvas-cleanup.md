---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Boards and A2UI are the only way Pulse, dashboards and widgets are drawn; plus a time limit in Settings, Clear on /scheduled, and reaper counts on /health.

The two Settings → Appearance switches kept for one release (the previous widget renderer, the previous Pulse and dashboard layout) are gone, along with the old layout's pages and scripts. Widgets the A2UI converter can't draw yet (a `capture-image` control, video embeds) still draw with the previous renderer, so nothing disappears. `/boards/<id>/canvas` now leads to the board's page. In-page confirm dialogs (Hide all, Decline drafted agents) work on every page again.

- **Stop a run after** (minutes) in an agent's Settings → When it runs sets its whole-run time limit (`timeoutSec`); sua can change it too (`timeoutMinutes`).
- **Clear** on each `/scheduled` row removes the schedule after an in-page confirm; the agent stays and runs when asked.
- `GET /health`: `runs_last_hour` counts only the last hour (it was every run), and a new `reaper` block counts the stuck or orphaned runs cleaned up since start.
