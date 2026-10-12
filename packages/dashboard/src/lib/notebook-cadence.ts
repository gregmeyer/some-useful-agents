/**
 * Runs each notebook's pipeline on its schedule (its `cadence`, a cron).
 * The scheduler daemon runs agents; a notebook's pipeline needs the
 * dashboard (pipeline inputs, the keeper, passes), so its schedule lives
 * here, on the same footing as the daily digest: a tick at boot (catch-up
 * after downtime) and once a minute.
 *
 * Each tick takes the slot the schedule last fired for. A slot is run once:
 * the notebook records it (`cadence_fired_at`), so a restart never repeats
 * one, and a notebook down for days catches up once, not once per missed
 * slot. A schedule seen for the first time waits for its next slot.
 */
import { NotebookStore, lastFireTime, validateScheduleInterval } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { startNotebookPipeline } from './notebook-pipeline.js';

type Ctx = ReturnType<typeof getContext>;

const TICK_MS = 60_000;

export type CadenceOutcome = 'started' | 'waiting' | 'busy' | 'skipped' | 'first-seen';

/** One pass over the notebooks; returns what happened to each with a schedule. Exported for tests. */
export function runNotebookCadenceOnce(ctx: Ctx, now: Date = new Date()): Map<string, CadenceOutcome> {
  const out = new Map<string, CadenceOutcome>();
  const store = NotebookStore.fromHandle(ctx.runStore.databaseHandle());
  for (const nb of store.list({ status: 'active' })) {
    if (!nb.cadence || nb.pipeline.length === 0) continue;
    try { validateScheduleInterval(nb.cadence, {}); } catch { continue; }
    const slot = lastFireTime(nb.cadence, now);
    if (!slot) continue;
    if (!nb.cadenceFiredAt) {
      // Just scheduled: the slot before now isn't owed; the next one is.
      store.markCadenceFired(nb.id, slot);
      out.set(nb.id, 'first-seen');
      continue;
    }
    if (Date.parse(nb.cadenceFiredAt) >= Date.parse(slot)) { out.set(nb.id, 'waiting'); continue; }
    const r = startNotebookPipeline(ctx, nb.id, { scheduled: true });
    // Already running (someone pressed Run): try again next tick. Anything else is settled for this slot.
    if (!r.started && r.reason === 'Its pipeline is already running.') { out.set(nb.id, 'busy'); continue; }
    store.markCadenceFired(nb.id, slot);
    out.set(nb.id, r.started ? 'started' : 'skipped');
  }
  return out;
}

/** Start the loop. Returns a stop-fn for `close()`. Off with SUA_NOTEBOOK_SCHEDULES=0. */
export function startNotebookCadence(ctx: Ctx): () => void {
  if (process.env.SUA_NOTEBOOK_SCHEDULES === '0') return () => {};
  const tick = () => {
    try {
      runNotebookCadenceOnce(ctx);
    } catch (err) {
      console.warn('[notebook-schedule] tick failed:', err instanceof Error ? err.message : String(err));
    }
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
