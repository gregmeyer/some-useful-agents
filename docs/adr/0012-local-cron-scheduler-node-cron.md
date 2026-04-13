# ADR-0012: Local cron scheduler via node-cron

## Status
Accepted

## Context

The agent YAML schema has always had a `schedule: "<cron>"` field. Until
PR #12, no code actually read it. Agents declared schedules but they
never fired. Users expecting "I'll write a YAML with a cron string and it
runs daily" hit silent failure.

Two paths to fix this:

1. **Use Temporal's Schedules API** — the TemporalProvider could own
   scheduling. Robust, survives restarts, integrates with Temporal Web UI.
   But requires Docker + a running Temporal server — a lot to ask for a
   "run this shell command daily" use case.

2. **Run cron locally in the LocalProvider** — a Node process reads agent
   YAMLs with schedule fields and fires them on cron expressions. Zero
   new infrastructure. Works immediately after `sua init`.

The local path hits the common case (first-run user wants a scheduled
dad-joke) without infrastructure cost. Temporal scheduling is still
valuable for agents that need durability, but it's an additive feature,
not a prerequisite.

## Decision

Add a `LocalScheduler` class in `@some-useful-agents/core` using
[node-cron](https://github.com/node-cron/node-cron). Zero native deps,
MIT-licensed, supports 5- and 6-field cron expressions.

New CLI commands:

- `sua schedule start` — foreground daemon. Loads agents with schedule
  fields, registers cron tasks, fires each on its expression.
  `triggeredBy: 'schedule'` on the resulting Run records.
- `sua schedule list` — shows agents with schedule fields + validation.
- `sua schedule validate <name>` — checks a specific agent's cron string.

`sua doctor` reports the scheduler as ready and counts scheduled agents.

For daemon behavior (run unattended), users daemonize with pm2, launchd,
or systemd. Not sua's concern in v1.

## Consequences

**Easier:**
- `sua init && sua tutorial` can realistically end with a scheduled agent,
  zero additional setup.
- Agent YAML `schedule` field is no longer a lie.
- Testing: a 6-field cron expression (`* * * * * *`) fires every second,
  making scheduler tests run in ~1.5s with real cron.

**Harder:**
- Hot reload: agents added after `sua schedule start` don't pick up until
  the daemon restarts. Documented; a file-watcher is future work.
- Two competing scheduler concepts long-term: LocalScheduler and Temporal
  Schedules. Temporal users running `sua schedule start` would
  double-fire. Mitigated by detecting provider at schedule-start time and
  refusing to run local scheduler if provider is Temporal. (Future.)

**Trade-offs accepted:**
- A foreground daemon approach is simpler than full system-service
  integration. Users wanting true "fire at 9am even when laptop is
  asleep" need OS-level scheduling (launchd, systemd timer) layered on
  top — doc-only for now.
