/**
 * Autonomous first-touch triage: the insert-hook kick (`maybeAutoFirstTouch`)
 * and the durable sweeper (`sweepInboxOnce`). Uses a real InboxStore against
 * a temp db and a spy triage fn — the engine itself is not under test here
 * (its guards have their own suites).
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, type InboxMessage } from '@some-useful-agents/core';
import type { getContext } from '../context.js';
import {
  maybeAutoFirstTouch,
  sweepInboxOnce,
  AUTO_TRIAGE_MAX_PER_SWEEP,
  AUTO_TRIAGE_MAX_CONCURRENT,
  type TriageFn,
} from './inbox-sweeper.js';

type Ctx = ReturnType<typeof getContext>;

let dir: string;
let store: InboxStore;
let ctx: Ctx;
let runTriage: Mock<TriageFn>;
let prevFlag: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-sweeper-'));
  store = new InboxStore(join(dir, 'runs.db'));
  ctx = {
    inboxStore: store,
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    inboxTriageStopped: new Set(),
  } as unknown as Ctx;
  runTriage = vi.fn<TriageFn>(async () => {});
  prevFlag = process.env.SUA_INBOX_AUTO_TRIAGE;
  process.env.SUA_INBOX_AUTO_TRIAGE = '1';
});

afterEach(() => {
  if (prevFlag === undefined) delete process.env.SUA_INBOX_AUTO_TRIAGE;
  else process.env.SUA_INBOX_AUTO_TRIAGE = prevFlag;
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function addFailure(overrides: Partial<Parameters<InboxStore['add']>[0]> = {}): InboxMessage {
  return store.add({
    priority: 'high',
    source: 'run-failure',
    title: 'Run failed: x',
    body: 'boom',
    ...overrides,
  });
}

describe('maybeAutoFirstTouch', () => {
  it('kicks triage for a fresh eligible message', () => {
    const m = addFailure();
    expect(maybeAutoFirstTouch(ctx, m.id, runTriage)).toBe(true);
    expect(runTriage).toHaveBeenCalledExactlyOnceWith(ctx, m.id);
  });

  it('no-ops when the flag is off (opt-out)', () => {
    process.env.SUA_INBOX_AUTO_TRIAGE = '0';
    const m = addFailure();
    expect(maybeAutoFirstTouch(ctx, m.id, runTriage)).toBe(false);
    expect(runTriage).not.toHaveBeenCalled();
  });

  it('is on by default (no env var set)', () => {
    delete process.env.SUA_INBOX_AUTO_TRIAGE;
    const m = addFailure();
    expect(maybeAutoFirstTouch(ctx, m.id, runTriage)).toBe(true);
  });

  it('never touches manual threads — the operator owns kickoff', () => {
    const m = addFailure({ source: 'manual' });
    expect(maybeAutoFirstTouch(ctx, m.id, runTriage)).toBe(false);
    expect(runTriage).not.toHaveBeenCalled();
  });

  it('skips already-touched threads (dedupe-key hit on an active conversation)', () => {
    const m = addFailure();
    store.addResponse(m.id, 'triage', 'already analyzed');
    expect(maybeAutoFirstTouch(ctx, m.id, runTriage)).toBe(false);
  });

  it('skips threads whose status moved off open', () => {
    const m = addFailure();
    store.updateStatus(m.id, 'awaiting_user');
    expect(maybeAutoFirstTouch(ctx, m.id, runTriage)).toBe(false);
  });

  it('respects the operator stop set and in-flight registry', () => {
    const stopped = addFailure({ dedupeKey: 'a' });
    ctx.inboxTriageStopped!.add(stopped.id);
    expect(maybeAutoFirstTouch(ctx, stopped.id, runTriage)).toBe(false);

    const inflight = addFailure({ dedupeKey: 'b' });
    ctx.inboxTriageAbortControllers.set(inflight.id, { runId: 'r', controller: new AbortController() });
    expect(maybeAutoFirstTouch(ctx, inflight.id, runTriage)).toBe(false);
    expect(runTriage).not.toHaveBeenCalled();
  });

  it('stands down at the global concurrency ceiling', () => {
    for (let i = 0; i < AUTO_TRIAGE_MAX_CONCURRENT; i++) {
      ctx.inboxTriageAbortControllers.set(`other-${i}`, { runId: `r${i}`, controller: new AbortController() });
    }
    const m = addFailure();
    expect(maybeAutoFirstTouch(ctx, m.id, runTriage)).toBe(false);
    expect(runTriage).not.toHaveBeenCalled();
  });

  it('no-ops without a store or for a missing message', () => {
    expect(maybeAutoFirstTouch({ ...ctx, inboxStore: undefined } as Ctx, 'x', runTriage)).toBe(false);
    expect(maybeAutoFirstTouch(ctx, 'no-such-id', runTriage)).toBe(false);
  });
});

describe('sweepInboxOnce', () => {
  it('kicks eligible items up to the per-sweep cap (zero age gate for the test)', () => {
    for (let i = 0; i < AUTO_TRIAGE_MAX_PER_SWEEP + 2; i++) addFailure({ dedupeKey: `k${i}` });
    expect(sweepInboxOnce(ctx, runTriage, 0)).toBe(AUTO_TRIAGE_MAX_PER_SWEEP);
    expect(runTriage).toHaveBeenCalledTimes(AUTO_TRIAGE_MAX_PER_SWEEP);
  });

  it('the default age gate leaves fresh items for the insert-hook path', () => {
    addFailure();
    expect(sweepInboxOnce(ctx, runTriage)).toBe(0); // row is younger than 20s
    expect(runTriage).not.toHaveBeenCalled();
  });

  it('skips stopped and in-flight threads but still fills the budget with others', () => {
    const a = addFailure({ dedupeKey: 'a' });
    const b = addFailure({ dedupeKey: 'b' });
    const c = addFailure({ dedupeKey: 'c' });
    ctx.inboxTriageStopped!.add(a.id);
    ctx.inboxTriageAbortControllers.set(b.id, { runId: 'r', controller: new AbortController() });
    expect(sweepInboxOnce(ctx, runTriage, 0)).toBe(1);
    expect(runTriage).toHaveBeenCalledExactlyOnceWith(ctx, c.id);
  });

  it('flag off → sweep is a no-op', () => {
    process.env.SUA_INBOX_AUTO_TRIAGE = '0';
    addFailure();
    expect(sweepInboxOnce(ctx, runTriage, 0)).toBe(0);
  });

  it('stands down entirely at the concurrency ceiling', () => {
    for (let i = 0; i < AUTO_TRIAGE_MAX_CONCURRENT; i++) {
      ctx.inboxTriageAbortControllers.set(`other-${i}`, { runId: `r${i}`, controller: new AbortController() });
    }
    addFailure();
    expect(sweepInboxOnce(ctx, runTriage)).toBe(0);
  });
});
