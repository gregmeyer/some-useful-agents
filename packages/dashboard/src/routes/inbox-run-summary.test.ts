/**
 * collectRunSummary is triage's window into what an agent returned (fed as
 * FOCUS_AGENT_RUN). The cap must be generous enough that a verbose data payload
 * (a full MLB scoreboard is ~8KB) reaches triage intact — a 2KB cap sliced off
 * after ~4 games, so triage couldn't see the team the operator asked about.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '@some-useful-agents/core';
import { collectRunSummary } from './inbox-catalog.js';

let dir: string;
let runStore: RunStore;

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-run-summary-'));
  runStore = new RunStore(join(dir, 'runs.db'));
  return { runStore } as never as ReturnType<typeof import('../context.js').getContext>;
}

afterEach(() => {
  try { runStore.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('collectRunSummary', () => {
  it('surfaces data ~7.4KB deep in a verbose result (past the old 2KB cap)', () => {
    const ctx = setup();
    // Mimic the mlb-scoreboard payload: a big JSON blob with the answer deep in.
    const result = 'x'.repeat(7400) + '"home_team": "Seattle Mariners", "home_score": 5' + 'y'.repeat(800);
    runStore.createRun({
      id: 'run-1', agentName: 'mlb-scoreboard', status: 'completed',
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      triggeredBy: 'dashboard', result,
    });
    const out = collectRunSummary(ctx, 'mlb-scoreboard');
    expect(out).toContain('Seattle Mariners');
    expect(out).not.toContain('(truncated');
  });

  it('truncates a pathologically huge result and points at the run', () => {
    const ctx = setup();
    runStore.createRun({
      id: 'run-2', agentName: 'firehose', status: 'completed',
      startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      triggeredBy: 'dashboard', result: 'z'.repeat(50_000),
    });
    const out = collectRunSummary(ctx, 'firehose');
    expect(out).toContain('(truncated');
    expect(out.length).toBeLessThan(15_000);
  });

  it('returns empty string when the agent has no runs', () => {
    const ctx = setup();
    expect(collectRunSummary(ctx, 'nonexistent')).toBe('');
  });
});
