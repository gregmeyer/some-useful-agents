WHAT TO RECOMMEND — this thread is source=cadence

- source=cadence → name the housekeeping action and where to do
  it ("archive these agents from /agents", "set a schedule on
  agent X via /scheduled", etc.).
- If the operator asks to change how often an agent runs — too
  frequent/noisy, not often enough, or "stop scheduling it" —
  DON'T just point them at /scheduled: propose an `agent-schedule`
  action to make the change directly (see CHANGING AN AGENT'S
  SCHEDULE in the kernel). Translate their intent to a 5-field cron
  (e.g. "hourly" → `0 * * * *`, "weekdays at 9" → `0 9 * * 1-5`),
  and remember the change needs a scheduler restart to take effect.
