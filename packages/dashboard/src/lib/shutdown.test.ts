import { describe, it, expect } from 'vitest';
import { settleInFlight } from './shutdown.js';
import { BackgroundTasks } from './background.js';
import type { DashboardContext } from '../context.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '@some-useful-agents/core';
import { STOPPED_BY_SHUTDOWN } from './shutdown.js';

type Ctx = Pick<DashboardContext, 'activeRuns' | 'inboxTriageAbortControllers' | 'background'>;
const ctxWith = (): Ctx => ({ activeRuns: new Map(), inboxTriageAbortControllers: new Map(), background: new BackgroundTasks() });

/** A run that ends `afterMs` after it starts, or when aborted (as the executor does: it records the cancel, then leaves activeRuns). */
function startRun(ctx: Ctx, id: string, afterMs: number): { ended: () => 'finished' | 'cancelled' | undefined } {
  const ac = new AbortController();
  ctx.activeRuns.set(id, ac);
  let how: 'finished' | 'cancelled' | undefined;
  const t = setTimeout(() => { how = 'finished'; ctx.activeRuns.delete(id); }, afterMs);
  ac.signal.addEventListener('abort', () => { clearTimeout(t); setTimeout(() => { how = 'cancelled'; ctx.activeRuns.delete(id); }, 20); });
  return { ended: () => how };
}

describe('settleInFlight (what close() does with work in flight)', () => {
  it('lets work that finishes within the grace period finish, and stops nothing', async () => {
    const ctx = ctxWith();
    const run = startRun(ctx, 'r1', 40);
    let wrote = false;
    ctx.background!.run('keeper', new Promise<void>((r) => setTimeout(() => { wrote = true; r(); }, 60)));
    const out = await settleInFlight(ctx, 1000, 500);
    expect(out).toEqual({ stopped: [], unfinished: [] });
    expect(run.ended()).toBe('finished');
    expect(wrote).toBe(true);
  });

  it('stops a run still going after the grace period, and waits for it to record that', async () => {
    const ctx = ctxWith();
    const run = startRun(ctx, 'long', 60_000);
    const out = await settleInFlight(ctx, 50, 1000);
    expect(out.stopped).toEqual(['run long']);
    expect(out.unfinished).toEqual([]);
    expect(run.ended()).toBe('cancelled');
  });

  it('names work that still has not settled when the stores are about to close', async () => {
    const ctx = ctxWith();
    ctx.background!.run('stuck page decision', new Promise(() => undefined));
    const out = await settleInFlight(ctx, 30, 30);
    expect(out.unfinished).toEqual(['stuck page decision']);
  });

  it('records a run that ignores the stop as cancelled, with the reason, instead of leaving it running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sua-shutdown-'));
    const runStore = new RunStore(join(dir, 'runs.db'));
    try {
      const run = { id: 'r-slow', agentName: 'slow', status: 'running' as const, startedAt: new Date().toISOString(), triggeredBy: 'dashboard' as const };
      runStore.createRun(run);
      const ctx = { ...ctxWith(), runStore };
      ctx.activeRuns.set(run.id, new AbortController()); // aborting it does nothing: like a shell whose child holds its output open
      const out = await settleInFlight(ctx, 20, 50);
      expect(out.stopped).toEqual([`run ${run.id}`]);
      expect(ctx.activeRuns.size).toBe(0);
      expect(runStore.getRun(run.id)).toMatchObject({ status: 'cancelled', error: STOPPED_BY_SHUTDOWN });
    } finally {
      runStore.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
