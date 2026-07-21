import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { reapOrphanedRuns, reapStuckRuns, parseEtime } from './run-orphan-reaper.js';
import type { NodeExecutionRecord } from './agent-v2-types.js';

// Per-test tmpdir (see run-store.test.ts for context).
let testDir: string;
let store: RunStore;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'sua-orphan-reaper-'));
  store = new RunStore(join(testDir, 'orphan-reaper.db'));
});

afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function mkExec(runId: string, nodeId: string, overrides?: Partial<NodeExecutionRecord>): NodeExecutionRecord {
  return {
    runId,
    nodeId,
    workflowVersion: 1,
    status: 'running',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('reapOrphanedRuns', () => {
  it('transitions a single running run + its running node to failed/abandoned', () => {
    store.createRun({ id: 'orphan-1', agentName: 'planner', status: 'running', startedAt: '2026-05-26T03:29:13.760Z', triggeredBy: 'dashboard' });
    store.createNodeExecution(mkExec('orphan-1', 'plan'));

    const result = reapOrphanedRuns(store, { now: '2026-05-26T03:42:30.777Z' });

    expect(result.runsReaped).toBe(1);
    expect(result.nodesReaped).toBe(1);
    expect(result.reapedRunIds).toEqual(['orphan-1']);

    const run = store.getRun('orphan-1');
    expect(run?.status).toBe('failed');
    expect(run?.completedAt).toBe('2026-05-26T03:42:30.777Z');
    expect(run?.error).toMatch(/abandoned/i);

    const node = store.getNodeExecution('orphan-1', 'plan');
    expect(node?.status).toBe('failed');
    expect(node?.errorCategory).toBe('abandoned');
    expect(node?.completedAt).toBe('2026-05-26T03:42:30.777Z');
  });

  it('leaves terminal-status runs untouched', () => {
    store.createRun({ id: 'done-1',     agentName: 'x', status: 'completed', startedAt: '2026-05-26T01:00:00Z', completedAt: '2026-05-26T01:01:00Z', triggeredBy: 'cli' });
    store.createRun({ id: 'failed-1',   agentName: 'x', status: 'failed',    startedAt: '2026-05-26T01:00:00Z', completedAt: '2026-05-26T01:01:00Z', error: 'real failure', triggeredBy: 'cli' });
    store.createRun({ id: 'cancel-1',   agentName: 'x', status: 'cancelled', startedAt: '2026-05-26T01:00:00Z', completedAt: '2026-05-26T01:01:00Z', error: 'user cancelled', triggeredBy: 'cli' });

    const result = reapOrphanedRuns(store);

    expect(result.runsReaped).toBe(0);
    expect(store.getRun('done-1')?.status).toBe('completed');
    expect(store.getRun('failed-1')?.error).toBe('real failure');
    expect(store.getRun('cancel-1')?.error).toBe('user cancelled');
  });

  it('finalizes only running/pending node executions; preserves completed ones', () => {
    // Multi-node run that died mid-DAG: one completed, one was running, one was queued.
    store.createRun({ id: 'multi', agentName: 'p', status: 'running', startedAt: '2026-05-26T03:00:00Z', triggeredBy: 'dashboard' });
    store.createNodeExecution(mkExec('multi', 'a', { status: 'completed', completedAt: '2026-05-26T03:01:00Z', result: 'ok', exitCode: 0 }));
    store.createNodeExecution(mkExec('multi', 'b', { status: 'running' }));
    store.createNodeExecution(mkExec('multi', 'c', { status: 'pending' }));

    const result = reapOrphanedRuns(store);

    expect(result.runsReaped).toBe(1);
    expect(result.nodesReaped).toBe(2); // b + c

    expect(store.getNodeExecution('multi', 'a')?.status).toBe('completed'); // untouched
    expect(store.getNodeExecution('multi', 'a')?.result).toBe('ok');
    expect(store.getNodeExecution('multi', 'b')?.status).toBe('failed');
    expect(store.getNodeExecution('multi', 'b')?.errorCategory).toBe('abandoned');
    expect(store.getNodeExecution('multi', 'c')?.status).toBe('failed');
    expect(store.getNodeExecution('multi', 'c')?.errorCategory).toBe('abandoned');
  });

  it('idempotent: a second call after reaping is a no-op', () => {
    store.createRun({ id: 'orphan-2', agentName: 'x', status: 'running', startedAt: '2026-05-26T03:00:00Z', triggeredBy: 'cli' });
    store.createNodeExecution(mkExec('orphan-2', 'plan'));

    const first = reapOrphanedRuns(store);
    expect(first.runsReaped).toBe(1);

    const second = reapOrphanedRuns(store);
    expect(second.runsReaped).toBe(0);
    expect(second.nodesReaped).toBe(0);
  });

  it('reaps pending runs the same way as running runs', () => {
    // A `pending` run was created (DB write) but the executor never picked it up
    // because the dashboard died between createRun and the first node spawn.
    store.createRun({ id: 'pre', agentName: 'x', status: 'pending', startedAt: '2026-05-26T03:00:00Z', triggeredBy: 'schedule' });

    const result = reapOrphanedRuns(store);

    expect(result.runsReaped).toBe(1);
    expect(store.getRun('pre')?.status).toBe('failed');
  });
});

describe('reapOrphanedRuns — PID kill (PR C)', () => {
  it('persists childPid/childStartedAtMs through createNodeExecution/listNodeExecutions', () => {
    // The DB plumbing has to round-trip these fields cleanly or the kill
    // path can never see them. Sanity-check first.
    store.createRun({ id: 'r-pid', agentName: 'x', status: 'running', startedAt: '2026-05-26T03:00:00Z', triggeredBy: 'cli' });
    store.createNodeExecution(mkExec('r-pid', 'n', { childPid: 12345, childStartedAtMs: 1700000000000 }));
    const fetched = store.getNodeExecution('r-pid', 'n');
    expect(fetched?.childPid).toBe(12345);
    expect(fetched?.childStartedAtMs).toBe(1700000000000);
  });

  it('calls killProcess for rows that carry a pid, and counts the kills', () => {
    const killed: Array<{ pid: number; startedAtMs: number }> = [];
    store.createRun({ id: 'r-k', agentName: 'x', status: 'running', startedAt: '2026-05-26T03:00:00Z', triggeredBy: 'cli' });
    store.createNodeExecution(mkExec('r-k', 'a', { childPid: 1111, childStartedAtMs: 1_700_000_000_000 }));
    store.createNodeExecution(mkExec('r-k', 'b', { childPid: 2222, childStartedAtMs: 1_700_000_010_000 }));

    const result = reapOrphanedRuns(store, {
      killProcess: (pid, startedAtMs) => { killed.push({ pid, startedAtMs }); return true; },
    });

    expect(killed).toEqual([
      { pid: 1111, startedAtMs: 1_700_000_000_000 },
      { pid: 2222, startedAtMs: 1_700_000_010_000 },
    ]);
    expect(result.pidsKilled).toBe(2);
    expect(result.nodesReaped).toBe(2);
  });

  it('does NOT call killProcess for rows without a pid (non-spawning paths)', () => {
    const killed: number[] = [];
    store.createRun({ id: 'r-mcp', agentName: 'x', status: 'running', startedAt: '2026-05-26T03:00:00Z', triggeredBy: 'cli' });
    // MCP / built-in tool nodes don't spawn a child process.
    store.createNodeExecution(mkExec('r-mcp', 'mcp-call'));

    const result = reapOrphanedRuns(store, {
      killProcess: (pid) => { killed.push(pid); return true; },
    });

    expect(killed).toEqual([]);
    expect(result.pidsKilled).toBe(0);
    expect(result.nodesReaped).toBe(1); // row still finalized
  });

  it('does not increment pidsKilled when killProcess declines (PID reuse)', () => {
    store.createRun({ id: 'r-skip', agentName: 'x', status: 'running', startedAt: '2026-05-26T03:00:00Z', triggeredBy: 'cli' });
    store.createNodeExecution(mkExec('r-skip', 'a', { childPid: 9999, childStartedAtMs: 1_700_000_000_000 }));

    const result = reapOrphanedRuns(store, { killProcess: () => false });

    expect(result.pidsKilled).toBe(0);
    expect(result.nodesReaped).toBe(1); // row still finalized
    expect(store.getNodeExecution('r-skip', 'a')?.errorCategory).toBe('abandoned');
  });
});

describe('reapStuckRuns — periodic watchdog', () => {
  // Fixed clock. `startedAt` values are chosen relative to this.
  const NOW = Date.parse('2026-07-20T18:20:00Z');
  const past = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
  const alwaysAlive = () => true;
  const alwaysDead = () => false;
  const noopKill = () => true;

  it('leaves a run with a LIVE child process alone (past grace)', () => {
    store.createRun({ id: 'live', agentName: 'x', status: 'running', startedAt: past(300), triggeredBy: 'dashboard' });
    store.createNodeExecution(mkExec('live', 'n', { childPid: 4242, childStartedAtMs: NOW - 300_000 }));

    const res = reapStuckRuns(store, { nowMs: NOW, isAlive: alwaysAlive, killProcess: noopKill });

    expect(res.runsReaped).toBe(0);
    expect(store.getRun('live')?.status).toBe('running');
  });

  it('reaps a run whose child is DEAD and older than the grace window', () => {
    store.createRun({ id: 'dead', agentName: 'x', status: 'running', startedAt: past(300), triggeredBy: 'dashboard' });
    store.createNodeExecution(mkExec('dead', 'n', { childPid: 5555, childStartedAtMs: NOW - 300_000 }));
    const killed: number[] = [];

    const res = reapStuckRuns(store, {
      now: '2026-07-20T18:20:00Z', nowMs: NOW,
      isAlive: alwaysDead,
      killProcess: (pid) => { killed.push(pid); return true; },
    });

    expect(res.runsReaped).toBe(1);
    expect(res.nodesReaped).toBe(1);
    expect(killed).toEqual([5555]);
    expect(store.getRun('dead')?.status).toBe('failed');
    expect(store.getRun('dead')?.error).toMatch(/watchdog/i);
    expect(store.getNodeExecution('dead', 'n')?.errorCategory).toBe('abandoned');
  });

  it('does NOT reap a run inside the grace window even if the child looks dead', () => {
    store.createRun({ id: 'young', agentName: 'x', status: 'running', startedAt: past(30), triggeredBy: 'dashboard' });
    store.createNodeExecution(mkExec('young', 'n', { childPid: 6666, childStartedAtMs: NOW - 30_000 }));

    const res = reapStuckRuns(store, { nowMs: NOW, isAlive: alwaysDead, killProcess: noopKill });

    expect(res.runsReaped).toBe(0);
    expect(store.getRun('young')?.status).toBe('running');
  });

  it('reaps by the age ceiling when there is no child pid to probe (in-process node hang)', () => {
    // A node with no childPid (built-in/control-flow) can't be probed for
    // liveness — only the generous max-age backstop reaps it.
    store.createRun({ id: 'old', agentName: 'x', status: 'running', startedAt: past(40 * 60), triggeredBy: 'schedule' });
    store.createNodeExecution(mkExec('old', 'n')); // no childPid
    let aliveCalls = 0;

    const res = reapStuckRuns(store, {
      nowMs: NOW,
      isAlive: () => { aliveCalls++; return false; },
      killProcess: noopKill,
    });

    expect(res.runsReaped).toBe(1);
    expect(aliveCalls).toBe(0); // no pid → liveness never probed
    expect(store.getRun('old')?.status).toBe('failed');
  });

  it('does NOT reap a childless run within the age ceiling (in-process, still working)', () => {
    store.createRun({ id: 'inproc', agentName: 'x', status: 'running', startedAt: past(300), triggeredBy: 'dashboard' });
    store.createNodeExecution(mkExec('inproc', 'n')); // no childPid, 5m old, under 30m ceiling

    const res = reapStuckRuns(store, { nowMs: NOW, isAlive: alwaysDead, killProcess: noopKill });

    expect(res.runsReaped).toBe(0);
    expect(store.getRun('inproc')?.status).toBe('running');
  });

  it('skips Temporal-backed runs (Temporal recovers its own activities)', () => {
    store.createRun({ id: 'temporal', agentName: 'x', status: 'running', startedAt: past(40 * 60), triggeredBy: 'schedule', usedWorkflowProvider: 'temporal' });
    store.createNodeExecution(mkExec('temporal', 'n', { childPid: 7777, childStartedAtMs: NOW - 2_400_000 }));

    const res = reapStuckRuns(store, { nowMs: NOW, isAlive: alwaysDead, killProcess: noopKill });

    expect(res.runsReaped).toBe(0);
    expect(store.getRun('temporal')?.status).toBe('running');
  });
});

describe('parseEtime', () => {
  it('parses MM:SS', () => {
    expect(parseEtime('00:30')).toBe(30);
    expect(parseEtime('02:15')).toBe(135);
  });
  it('parses HH:MM:SS', () => {
    expect(parseEtime('01:02:03')).toBe(3723);
  });
  it('parses DD-HH:MM:SS', () => {
    expect(parseEtime('2-03:04:05')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });
  it('tolerates surrounding whitespace', () => {
    expect(parseEtime('  00:42  ')).toBe(42);
  });
  it('returns null on garbage', () => {
    expect(parseEtime('not-a-time')).toBeNull();
    expect(parseEtime('')).toBeNull();
    expect(parseEtime('00:99:00:00')).toBeNull();
  });
});
