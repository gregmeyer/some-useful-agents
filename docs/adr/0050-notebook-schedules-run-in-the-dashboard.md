# ADR-0050: Notebook schedules run in the dashboard, not the scheduler daemon

- Status: accepted
- Date: 2026-10-07
- Deciders: Greg Meyer

## Context

A notebook stores a `cadence` (a five-field cron) for its pipeline, set by the drafter, the Edit
form or sua in the notebook's conversation. Nothing ran it.

sua already has a scheduler: the `schedule` daemon (`sua schedule start`, `LocalScheduler`). It is
a separate process. It loads scheduled agents once at startup (a schedule change needs a restart)
and runs them in-process with the DAG executor.

A notebook's pipeline is more than running agents. It builds each agent's inputs from the notebook
(`pipelineInputs`), opens a pass, runs the notebook keeper (or files a structured block directly),
fetches pictures and records what happened. All of that lives in the dashboard
(`lib/notebook-pipeline.ts`) and uses the dashboard's context, including the in-memory guard that
stops one notebook's pipeline running twice at once.

## Decision

**Notebook schedules run in the dashboard process**, in `lib/notebook-cadence.ts`, alongside the
daily digest and the inbox sweepers: one tick at boot (catch-up after downtime), then one a minute.
They call the same `startNotebookPipeline` as the Run button.

- **One run per slot.** Each tick takes the slot the cron last fired for (`lastFireTime`). The
  notebook records the slot it has handled (`notebooks.cadence_fired_at`). A restart never repeats a
  slot, and a notebook that was down for days catches up **once**, not once per missed slot.
- **A new schedule waits.** The first time a schedule is seen, or after it changes, the slot
  already past is marked handled. The first run is the next slot.
- **Busy means retry.** If the pipeline is already running (someone pressed Run), the slot stays
  open and the next tick tries again. Any other refusal (closed, nothing to run) settles the slot.
- **Scheduled passes are marked** (`notebook_passes.trigger = 'schedule'`), so "How it was made"
  can tell a scheduled run from a pressed one.
- `SUA_NOTEBOOK_SCHEDULES=0` turns the loop off.

## Consequences

- Notebook schedules run only while the dashboard runs. Under `sua daemon` it always does. The
  scheduler daemon's heartbeat and "N agents" count don't include notebooks.
- A schedule change takes effect on the next tick, with no restart (unlike agent schedules).
- Moving schedules to the daemon later would mean moving the pipeline (inputs, keeper, passes) into
  core first. The slot bookkeeping (`cadence_fired_at`) would move with it unchanged.
