/**
 * A node's persisted `childPid` must not outlive the child it names.
 *
 * `onSpawn` records the pid so a restarted dashboard can SIGKILL an orphan
 * instead of letting it burn tokens. But nothing cleared it, and a node can
 * outlive its child. The sharpest case is the LLM provider waterfall: a CLI
 * provider (codex, claude) spawns a child and records its pid, while an
 * `openai`-kind provider is a plain HTTP call that spawns nothing. When the
 * chain falls from the former to the latter, the row kept pointing at the dead
 * CLI child.
 *
 * The stuck-run watchdog probes exactly that field for liveness, so it read
 * "every child of this run is dead" and reaped a node that was mid-request.
 * Observed on inbox-triage: 12 runs reaped while working, each finishing
 * moments later and overwriting `status` back to `completed` — leaving
 * successful runs permanently labelled with a watchdog error, and firing a
 * "Run failed: inbox-triage" inbox alert every day.
 *
 * These tests use real child processes and the real store rather than
 * asserting the callback fires, because the bug was in the wiring, not in the
 * callback.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { reapStuckRuns } from './run-orphan-reaper.js';
import { spawnNodeReal } from './node-spawner.js';
import { executeAgentDag } from './dag-executor.js';
import type { Agent, NodeExecutionRecord } from './agent-v2-types.js';

for (const k of ['PATH', 'HOME']) {
  if (!process.env[k]) process.env[k] = k === 'PATH' ? '/usr/bin:/bin' : '/tmp';
}

let dir: string;
let store: RunStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-childpid-'));
  store = new RunStore(join(dir, 'runs.db'));
});
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('spawnNodeReal — child lifecycle callbacks', () => {
  const opts = { agentId: 'a', agentSource: 'local' as const };

  it('reports the child gone after reporting it spawned', async () => {
    const events: string[] = [];
    const res = await spawnNodeReal(
      { id: 'n', type: 'shell', command: 'echo hi' },
      { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      opts,
      undefined,
      undefined,
      () => events.push('spawn'),
      () => events.push('exit'),
    );

    expect(res.exitCode).toBe(0);
    expect(events).toEqual(['spawn', 'exit']);
  });

  it('reports the child gone when it exits non-zero too', async () => {
    const events: string[] = [];
    const res = await spawnNodeReal(
      { id: 'n', type: 'shell', command: 'exit 3' },
      { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      opts,
      undefined,
      undefined,
      () => events.push('spawn'),
      () => events.push('exit'),
    );

    expect(res.exitCode).toBe(3);
    expect(events).toEqual(['spawn', 'exit']);
  });

  it('reports the child gone exactly once', async () => {
    let exits = 0;
    await spawnNodeReal(
      { id: 'n', type: 'shell', command: 'echo hi' },
      { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      opts,
      undefined,
      undefined,
      undefined,
      () => { exits++; },
    );

    expect(exits).toBe(1);
  });
});

describe('dag-executor — the persisted pid does not outlive the child', () => {
  it('clears childPid on the node row once the child has exited', async () => {
    const agent: Agent = {
      id: 'pid-agent',
      name: 'Pid',
      status: 'active',
      source: 'local',
      mcp: false,
      version: 1,
      nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
    };

    const run = await executeAgentDag(agent, { triggeredBy: 'cli' }, { runStore: store });
    expect(run.status).toBe('completed');

    const node = store.getNodeExecution(run.id, 'main');
    // The child really did spawn (this is the real spawner, not a canned one),
    // and the row must not still be naming it.
    expect(node?.childPid ?? null).toBeNull();
    expect(node?.childStartedAtMs ?? null).toBeNull();
  });
});

describe('reapStuckRuns — a node that outlived its child', () => {
  const NOW = Date.parse('2026-09-10T15:30:00Z');
  const past = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

  function mkExec(runId: string, over?: Partial<NodeExecutionRecord>): NodeExecutionRecord {
    return {
      runId,
      nodeId: 'triage',
      workflowVersion: 1,
      status: 'running',
      startedAt: past(300),
      ...over,
    };
  }

  /**
   * The regression. A run whose CLI provider died and whose HTTP fallback is
   * still working looks, to the watchdog, exactly like a run whose only child
   * is dead — unless the pid was cleared when that child exited.
   */
  it('reaps while a dead pid is still on the row (the bug)', () => {
    store.createRun({ id: 'stale', agentName: 'inbox-triage', status: 'running', startedAt: past(300), triggeredBy: 'schedule' });
    store.createNodeExecution(mkExec('stale', { childPid: 5555, childStartedAtMs: NOW - 300_000 }));

    const res = reapStuckRuns(store, { nowMs: NOW, isAlive: () => false, killProcess: () => true });

    expect(res.runsReaped).toBe(1);
    expect(store.getRun('stale')?.status).toBe('failed');
  });

  it('leaves the same run alone once the exited child cleared its pid (the fix)', () => {
    store.createRun({ id: 'cleared', agentName: 'inbox-triage', status: 'running', startedAt: past(300), triggeredBy: 'schedule' });
    store.createNodeExecution(mkExec('cleared', { childPid: 5555, childStartedAtMs: NOW - 300_000 }));

    // What onChildExit does when the CLI provider exits and the waterfall
    // moves to an HTTP provider that spawns nothing.
    store.updateNodeExecution('cleared', 'triage', { childPid: null, childStartedAtMs: null });

    const res = reapStuckRuns(store, { nowMs: NOW, isAlive: () => false, killProcess: () => true });

    expect(res.runsReaped).toBe(0);
    expect(store.getRun('cleared')?.status).toBe('running');
  });

  it('still reaps a genuinely wedged childless run at the age ceiling', () => {
    // Clearing the pid must not buy an unbounded reprieve: past the 30m
    // backstop the run is still reaped, which is what eventually catches a
    // hung HTTP request.
    store.createRun({ id: 'wedged', agentName: 'inbox-triage', status: 'running', startedAt: past(40 * 60), triggeredBy: 'schedule' });
    store.createNodeExecution(mkExec('wedged', { startedAt: past(40 * 60) }));

    const res = reapStuckRuns(store, { nowMs: NOW, isAlive: () => false, killProcess: () => true });

    expect(res.runsReaped).toBe(1);
    expect(store.getRun('wedged')?.status).toBe('failed');
  });
});
