/**
 * collectLatestRunNodeDigest surfaces the per-node output of an agent's latest
 * completed run, so the analyzer sees intermediate node output (e.g. a query
 * returning 0 rows) instead of only the terminal `end`-node message.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '@some-useful-agents/core';
import { collectLatestRunNodeDigest } from './inbox-catalog.js';

let dir: string;
let runStore: RunStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-node-digest-'));
  runStore = new RunStore(join(dir, 'runs.db'));
  return { runStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { runStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('collectLatestRunNodeDigest', () => {
  it('returns empty when the agent has no completed run', () => {
    const ctx = setup();
    expect(collectLatestRunNodeDigest(ctx, 'nope')).toBe('');
  });

  it('digests each node output of the latest completed run, past the end message', () => {
    const ctx = setup();
    runStore.createRun({ id: 'r1', agentName: 'adr-browser', status: 'completed', startedAt: '2026-07-21T00:00:00Z', completedAt: '2026-07-21T00:00:01Z', triggeredBy: 'dashboard', result: 'Flow complete.' });
    runStore.createNodeExecution({ runId: 'r1', nodeId: 'query-adrs', workflowVersion: 1, status: 'completed', startedAt: '2026-07-21T00:00:00Z', completedAt: '2026-07-21T00:00:01Z', exitCode: 0, result: '{"success":true,"match_count":0,"adrs":[]}' });
    runStore.createNodeExecution({ runId: 'r1', nodeId: 'end', workflowVersion: 1, status: 'completed', startedAt: '2026-07-21T00:00:01Z', completedAt: '2026-07-21T00:00:01Z', exitCode: 0, result: 'Flow complete.' });

    const digest = collectLatestRunNodeDigest(ctx, 'adr-browser');
    expect(digest).toContain('PER-NODE OUTPUT');
    // The real diagnostic signal — invisible in the terminal result — is present.
    expect(digest).toContain('query-adrs [completed]');
    expect(digest).toContain('match_count":0');
    expect(digest).toContain('end [completed]');
  });

  it('prefers a node error over its result and truncates very long output', () => {
    const ctx = setup();
    runStore.createRun({ id: 'r2', agentName: 'x', status: 'completed', startedAt: '2026-07-21T00:00:00Z', completedAt: '2026-07-21T00:00:01Z', triggeredBy: 'cli', result: 'done' });
    runStore.createNodeExecution({ runId: 'r2', nodeId: 'big', workflowVersion: 1, status: 'completed', startedAt: '2026-07-21T00:00:00Z', completedAt: '2026-07-21T00:00:01Z', exitCode: 0, result: 'x'.repeat(5000) });
    const digest = collectLatestRunNodeDigest(ctx, 'x');
    expect(digest).toContain('big [completed]');
    expect(digest).toContain('…'); // per-node cap applied
    expect(digest.length).toBeLessThan(6000);
  });
});
