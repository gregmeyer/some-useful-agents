import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlannerTelemetryStore } from '@some-useful-agents/core';
import {
  pollUntilDone,
  assertTelemetry,
  snapshotState,
  rollbackTo,
  type SmokeContext,
} from './planner.js';

// ── pollUntilDone ──────────────────────────────────────────────────────

describe('pollUntilDone', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns immediately on terminal status=done', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ ok: true, status: 'done', plan: { intent: 'agent' } }),
    })) as unknown as typeof fetch;
    const result = await pollUntilDone('http://x', 'run-1', 5_000, 0);
    expect(result.final.status).toBe('done');
    expect(result.chain).toEqual(['run-1']);
    expect(result.retries).toBe(0);
  });

  it('follows retry chain when status=retrying', async () => {
    const responses = [
      { ok: true, status: 'retrying' as const, runId: 'run-2', attempt: 2, criticErrors: [] },
      { ok: true, status: 'retrying' as const, runId: 'run-3', attempt: 3, criticErrors: [] },
      { ok: true, status: 'done' as const, plan: { intent: 'agent' } },
    ];
    let i = 0;
    globalThis.fetch = vi.fn(async () => ({
      json: async () => responses[i++],
    })) as unknown as typeof fetch;
    const result = await pollUntilDone('http://x', 'run-1', 30_000, 0);
    expect(result.final.status).toBe('done');
    expect(result.chain).toEqual(['run-1', 'run-2', 'run-3']);
    expect(result.retries).toBe(2);
  });

  it('returns failed after maxMs even if still running', async () => {
    globalThis.fetch = vi.fn(async () => ({
      json: async () => ({ ok: true, status: 'running' as const, phase: 'Planning…' }),
    })) as unknown as typeof fetch;
    const result = await pollUntilDone('http://x', 'run-1', 100, 0);
    expect(result.final.status).toBe('failed');
    expect(result.final.error).toMatch(/timed out/);
  });
});

// ── assertTelemetry ────────────────────────────────────────────────────

describe('assertTelemetry', () => {
  let dir: string;
  let store: PlannerTelemetryStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sua-planner-cli-'));
    store = new PlannerTelemetryStore(join(dir, 'runs.db'));
  });
  afterEach(() => {
    try { store.close(); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null on a clean match', () => {
    store.recordStart('run-1', 'goal');
    store.recordExtract({ runId: 'run-1', status: 'ok', autofixCount: 0, timeToPlanMs: 1000, intent: 'agent' });
    expect(assertTelemetry(store, 'run-1', { extractStatus: 'ok', minAttempts: 1, maxAttempts: 1 })).toBeNull();
  });

  it('flags missing telemetry row', () => {
    expect(assertTelemetry(store, 'missing', {})).toMatch(/no planner_telemetry row/);
  });

  it('flags planAttempts below minAttempts', () => {
    store.recordStart('run-2', 'goal');
    expect(assertTelemetry(store, 'run-2', { minAttempts: 3 })).toMatch(/planAttempts=1/);
  });

  it('flags committed=true when not committed', () => {
    store.recordStart('run-3', 'goal');
    expect(assertTelemetry(store, 'run-3', { committed: true })).toMatch(/committedAt is null/);
  });

  it('flags committed=false when committed', () => {
    store.recordStart('run-4', 'goal');
    store.recordCommit('run-4', 1234);
    expect(assertTelemetry(store, 'run-4', { committed: false })).toMatch(/expected null/);
  });

  it('resolves alias chains so retry runIds match against root row', () => {
    store.recordStart('root', 'goal');
    store.recordRetrySpawn('root', 'retry-1');
    store.incrementAttempts('retry-1');
    expect(assertTelemetry(store, 'retry-1', { minAttempts: 2 })).toBeNull();
  });
});

// ── snapshotState / rollbackTo ─────────────────────────────────────────

describe('snapshotState / rollbackTo', () => {
  // Construct a minimal SmokeContext stub. Only the agentStore +
  // dashboardsStore methods used by snapshotState/rollbackTo need real
  // implementations; the rest can be type-assertion-stubs.
  function makeCtxStub() {
    const agents: Array<{ id: string }> = [];
    const dashboards: Array<{ id: string }> = [];
    const ctx = {
      agentStore: {
        listAgents: () => agents.slice(),
        deleteAgent: (id: string) => {
          const idx = agents.findIndex((a) => a.id === id);
          if (idx >= 0) agents.splice(idx, 1);
        },
      },
      dashboardsStore: {
        listDashboards: () => dashboards.slice(),
        deleteDashboard: (id: string) => {
          const idx = dashboards.findIndex((d) => d.id === id);
          if (idx >= 0) dashboards.splice(idx, 1);
        },
      },
    } as unknown as SmokeContext;
    return { ctx, agents, dashboards };
  }

  it('rolls back exactly the diff and leaves pre-existing items alone', () => {
    const { ctx, agents, dashboards } = makeCtxStub();
    agents.push({ id: 'pre-1' }, { id: 'pre-2' });
    dashboards.push({ id: 'user:home' });
    const snap = snapshotState(ctx);

    agents.push({ id: 'new-1' }, { id: 'new-2' });
    dashboards.push({ id: 'user:smoke' });

    rollbackTo(ctx, snap);
    expect(agents.map((a) => a.id).sort()).toEqual(['pre-1', 'pre-2']);
    expect(dashboards.map((d) => d.id)).toEqual(['user:home']);
  });

  it('is a no-op when nothing was created', () => {
    const { ctx, agents } = makeCtxStub();
    agents.push({ id: 'a' });
    const snap = snapshotState(ctx);
    rollbackTo(ctx, snap);
    expect(agents.map((a) => a.id)).toEqual(['a']);
  });
});
