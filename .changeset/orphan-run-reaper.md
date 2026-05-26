---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Fix: orphaned runs after dashboard restart no longer burn tokens silently.

When the dashboard process died mid-run (a `daemon restart`, a crash, an OOM), any in-flight LLM child process was reparented to launchd/init and kept running. The 180-second per-node timeout was an in-memory `setTimeout` inside the dashboard process — it died with the parent. The new dashboard had no `activeRuns` entry for the run and couldn't abort it, and the `runs` row sat at `status='running'` indefinitely. The user-cancel route's fallback path force-updated the `runs` row but left every `node_executions` row stuck on a spinner forever.

This release ships three fixes that close the bleed:

- **Orphan reaper on boot.** Any run still flagged `running` or `pending` when the dashboard starts is, by definition, an orphan — the only process that could be executing it is the dashboard, and it just started. The reaper transitions the run to `failed` and every still-`running`/`pending` node execution to `failed` with new `errorCategory='abandoned'` so dashboards stop polling, notify logic doesn't fire forever, and the audit trail explains the gap. Idempotent; safe to call repeatedly.

- **SIGKILL escalation on the cancel path.** When the abort signal fires, the spawner now SIGTERMs the child and escalates to SIGKILL after 5 seconds — matching the timeout path. A claude/codex CLI stuck in a slow HTTP read can no longer ignore SIGTERM indefinitely.

- **Cancel route finalizes node rows.** `POST /runs/:id/cancel`'s fallback (used when activeRuns is empty because the dashboard restarted between kickoff and cancel) now walks every `running`/`pending` node execution for the run and transitions it to `cancelled` alongside the run-level update.

Note: this release does NOT yet kill the orphaned child process itself — that requires persisting the child PID on the `node_executions` row (followup). What this stops is the state-machine bleed: rows stop sitting at `running` forever, and the run row gets a coherent terminal status.
