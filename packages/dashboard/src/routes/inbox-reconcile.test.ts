/**
 * Boot-time inbox reconciliation: action cards stranded `running` by a
 * restart are settled against run-store truth, genuinely in-flight runs get
 * resume waiters, and threads whose triage turn died with the process are
 * either re-fired (auto-triage on) or surfaced as "Your turn" (off).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type InboxActionMeta, type Run } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import { reconcileInboxOnBoot } from './inbox-reconcile.js';
import { runTriageAgent } from './inbox-engine.js';

// Partial-mock the engine: reconcile's re-fires must not hit a real triage
// run in tests, but finalizeActionFromOutcome/awaitRunTerminal stay real.
vi.mock('./inbox-engine.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./inbox-engine.js')>();
  return { ...actual, runTriageAgent: vi.fn(async () => {}) };
});

type Ctx = ReturnType<typeof getContext>;

let dir: string;
let store: InboxStore;
let runs: Map<string, Partial<Run>>;
let ctx: Ctx;
let prevFlag: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-reconcile-'));
  store = new InboxStore(join(dir, 'runs.db'));
  runs = new Map();
  ctx = {
    inboxStore: store,
    runStore: { getRun: (id: string) => (runs.get(id) as Run | undefined) ?? null },
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    inboxTriageStopped: new Set(),
  } as unknown as Ctx;
  prevFlag = process.env.SUA_INBOX_AUTO_TRIAGE;
  delete process.env.SUA_INBOX_AUTO_TRIAGE;
  vi.mocked(runTriageAgent).mockClear();
});

afterEach(() => {
  if (prevFlag === undefined) delete process.env.SUA_INBOX_AUTO_TRIAGE;
  else process.env.SUA_INBOX_AUTO_TRIAGE = prevFlag;
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function addThread(over: Partial<Parameters<InboxStore['add']>[0]> = {}) {
  return store.add({
    priority: 'high',
    source: 'run-failure',
    title: 'Run failed: x',
    body: 'boom',
    ...over,
  });
}

function addRunningAction(messageId: string, over: Partial<InboxActionMeta> = {}) {
  const meta: InboxActionMeta = {
    kind: 'action',
    agentId: 'some-agent',
    inputs: {},
    effect: 'read',
    status: 'running',
    startedAt: Date.now() - 60_000,
    ...over,
  } as InboxActionMeta;
  return store.addResponse(messageId, 'action', 'Running some-agent', JSON.stringify(meta));
}

function actionMeta(responseId: string): InboxActionMeta {
  return JSON.parse(store.getResponse(responseId)!.metaJson!) as InboxActionMeta;
}

describe('reconcileInboxOnBoot — stranded running actions', () => {
  it('settles a running action whose run completed while we were down', () => {
    const m = addThread();
    const r = addRunningAction(m.id, { runId: 'run-1' });
    runs.set('run-1', { id: 'run-1', status: 'completed', result: 'all good' });

    const res = reconcileInboxOnBoot(ctx);
    expect(res.finalized).toBe(1);
    const meta = actionMeta(r.id);
    expect(meta.status).toBe('completed');
    expect(meta.resultSummary).toBe('all good');
    expect(meta.endedAt).toBeTypeOf('number');
  });

  it('fails a running action whose run row is gone', () => {
    const m = addThread();
    const r = addRunningAction(m.id, { runId: 'run-gone' });

    const res = reconcileInboxOnBoot(ctx);
    expect(res.finalized).toBe(1);
    const meta = actionMeta(r.id);
    expect(meta.status).toBe('failed');
    expect(meta.refusalReason).toMatch(/restarted mid-action/);
  });

  it('fails a running action that never recorded a run id', () => {
    const m = addThread();
    const r = addRunningAction(m.id);

    const res = reconcileInboxOnBoot(ctx);
    expect(res.finalized).toBe(1);
    expect(actionMeta(r.id).status).toBe('failed');
    expect(actionMeta(r.id).refusalReason).toMatch(/before this action/);
  });

  it('attaches a resume waiter to a genuinely in-flight run and finalizes when it lands', async () => {
    const m = addThread();
    const r = addRunningAction(m.id, { runId: 'run-live' });
    // First getRun (reconcile's check) sees running; the waiter's first poll
    // sees the terminal state — no 750ms sleep needed.
    let calls = 0;
    (ctx.runStore as unknown as { getRun: (id: string) => Partial<Run> | null }).getRun = () => {
      calls += 1;
      return calls === 1
        ? { id: 'run-live', status: 'running' }
        : { id: 'run-live', status: 'completed', result: 'late but done' };
    };

    const res = reconcileInboxOnBoot(ctx);
    expect(res.resumed).toBe(1);
    expect(res.finalized).toBe(0);
    await vi.waitFor(() => {
      expect(actionMeta(r.id).status).toBe('completed');
    });
    expect(actionMeta(r.id).resultSummary).toBe('late but done');
  });

  it('leaves settled actions alone (idempotent on a clean inbox)', () => {
    const m = addThread();
    const r = addRunningAction(m.id, { runId: 'run-1', status: 'completed' });
    const res = reconcileInboxOnBoot(ctx);
    expect(res).toEqual({ finalized: 0, resumed: 0, refired: 0 });
    expect(actionMeta(r.id).status).toBe('completed');
  });
});

describe('reconcileInboxOnBoot — stranded triage turns', () => {
  function strandTriage(paused = false) {
    const m = addThread();
    store.addResponse(m.id, 'user', 'please fix this');
    store.updateStatus(m.id, 'triaged', { triageRunId: 'triage-dead' });
    // No run row for triage-dead → triage died with the old process.
    if (paused) store.setPaused(m.id, true);
    return m;
  }

  it('flag off: posts a note and surfaces the thread as awaiting_user', () => {
    const m = strandTriage();
    const res = reconcileInboxOnBoot(ctx);
    expect(res.refired).toBe(0);
    expect(runTriageAgent).not.toHaveBeenCalled();
    const responses = store.listResponses(m.id);
    expect(responses[responses.length - 1].body).toMatch(/restarted while triage was thinking/);
    expect(store.get(m.id)!.status).toBe('awaiting_user');
  });

  it('flag on: posts a note and re-fires triage once', () => {
    process.env.SUA_INBOX_AUTO_TRIAGE = '1';
    const m = strandTriage();
    const res = reconcileInboxOnBoot(ctx);
    expect(res.refired).toBe(1);
    expect(runTriageAgent).toHaveBeenCalledExactlyOnceWith(ctx, m.id);
    const responses = store.listResponses(m.id);
    expect(responses.some((r) => /restarted mid-conversation/.test(r.body))).toBe(true);
  });

  it('never re-engages a paused thread', () => {
    process.env.SUA_INBOX_AUTO_TRIAGE = '1';
    strandTriage(true);
    const res = reconcileInboxOnBoot(ctx);
    expect(res.refired).toBe(0);
    expect(runTriageAgent).not.toHaveBeenCalled();
  });

  it('a thread with a resume waiter attached does not also get a boot refire', async () => {
    process.env.SUA_INBOX_AUTO_TRIAGE = '1';
    const m = addThread();
    const r = addRunningAction(m.id, { runId: 'run-live' });
    runs.set('run-live', { id: 'run-live', status: 'running' });

    const res = reconcileInboxOnBoot(ctx);
    expect(res.resumed).toBe(1);
    expect(res.refired).toBe(0);
    expect(runTriageAgent).not.toHaveBeenCalled();

    // Let the waiter finish (don't leave it polling past the test): flip the
    // run terminal and wait for the finalize to land.
    runs.set('run-live', { id: 'run-live', status: 'completed', result: 'done' });
    await vi.waitFor(() => {
      expect(actionMeta(r.id).status).toBe('completed');
    }, { timeout: 3000 });
  });
});
