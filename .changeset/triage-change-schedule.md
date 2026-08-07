---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Inbox triage can change an agent's schedule.

Ask triage in plain English — "run the news digest hourly instead of daily",
"this is too noisy, make it weekly", "stop scheduling X" — and it proposes a new
`agent-schedule` action that sets (or clears) the agent's cron cadence. It
validates the cron (rejecting invalid or sub-minute expressions), applies it via
a targeted metadata update (no version bump), and reports the new cadence in plain
English. Route-handled and auto-approvable like the other editor actions.

Note: like the dashboard's existing schedule editor, a change takes effect on the
new cadence only after the scheduler daemon (`sua schedule start`) is restarted —
the action summary says so.
