/**
 * Terminal-phase telemetry for the build orchestrator.
 *
 * `/build` moved onto the orchestrator in #326. `recordStart` kept firing, but
 * every later write (`recordExtract`, `recordSmoke`, `incrementAttempts`) lived
 * on the `PlannerLoopRunner` path the route no longer reaches — the poll
 * handler returns as soon as `getSession()` hits. So every row since
 * 2026-05-20 sat at the `pending` schema default with no plan time and no
 * outcome, and `/metrics/planner` reported on a dataset that had stopped
 * growing 3.5 months earlier.
 *
 * `advanceAssembling` is synchronous and needs no LLM, so a session can be
 * driven to a terminal phase here without spending a build.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlannerTelemetryStore } from '@some-useful-agents/core';
import { advanceSession } from './build-orchestrator.js';

let dir: string;
let store: PlannerTelemetryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sua-build-telem-'));
  store = new PlannerTelemetryStore(join(dir, 'runs.db'));
});
afterEach(() => {
  try { store.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const VALID_YAML = 'id: one\nname: one agent\nnodes:\n  - id: n1\n    type: shell\n    command: echo hi\n';

const ctx = () => ({ plannerTelemetryStore: store }) as unknown as Parameters<typeof advanceSession>[0];

/** A session parked in `assembling`, one `advanceSession` away from done. */
function session(id: string, over: Record<string, unknown> = {}): Parameters<typeof advanceSession>[1] {
  return {
    id,
    goal: 'fetch the top 3 HN stories',
    focus: '',
    createdAt: Date.now() - 5_000,
    phase: 'assembling',
    phaseMessage: '',
    drafterRunIds: new Map(),
    drafterAttempts: new Map(),
    // intent 'agent' requires exactly one newAgents entry, which comes from
    // session.drafts — an empty map assembles into an invalid plan.
    drafts: new Map([['frag-a', { id: 'one', purpose: 'p', yaml: VALID_YAML }]]),
    draftOnly: false,
    survey: {
      intent: 'agent',
      summary: 'Three HN stories, daily.',
      matchedAgents: [],
      fragments: [],
      existingDashboards: [],
    },
    ...over,
  } as unknown as Parameters<typeof advanceSession>[1];
}

describe('orchestrator terminal telemetry', () => {
  it('stamps a finished build onto the row recordStart opened', async () => {
    store.recordStart('build-1', 'fetch the top 3 HN stories');
    expect(store.get('build-1')!.planExtractStatus).toBe('pending');

    const s = session('build-1');
    await advanceSession(ctx(), s);

    expect(s.phase).toBe('done');
    const row = store.get('build-1')!;
    expect(row.planExtractStatus).toBe('ok');
    expect(row.timeToPlanMs).toBeGreaterThan(0);
    expect(row.intent).toBe('agent');
  });

  it('records a failed build as failed, not as an extraction problem', async () => {
    store.recordStart('build-2', 'goal');
    // No survey → assembling fails the invariant check.
    const s = session('build-2', { survey: undefined });
    await advanceSession(ctx(), s);

    expect(s.phase).toBe('failed');
    expect(store.get('build-2')!.planExtractStatus).toBe('failed');
  });

  it('replays the worst fragment’s retries onto plan_attempts', async () => {
    store.recordStart('build-3', 'goal');
    const s = session('build-3', {
      drafterAttempts: new Map([['frag-a', 1], ['frag-b', 3]]),
    });
    await advanceSession(ctx(), s);

    expect(store.get('build-3')!.planAttempts).toBe(3);
  });

  it('records once, however many times the poll fires', async () => {
    // The wizard polls on an interval; the terminal guard at the top of
    // advanceSession is what keeps this from double-counting.
    store.recordStart('build-4', 'goal');
    const s = session('build-4');
    await advanceSession(ctx(), s);
    const first = store.get('build-4')!.timeToPlanMs;

    await advanceSession(ctx(), s);
    await advanceSession(ctx(), s);
    expect(store.get('build-4')!.timeToPlanMs).toBe(first);
    expect(store.get('build-4')!.planAttempts).toBe(1);
  });

  it('never fails a build when telemetry is unwired', async () => {
    const s = session('build-5');
    await advanceSession({} as unknown as Parameters<typeof advanceSession>[0], s);
    expect(s.phase).toBe('done');
  });
});
