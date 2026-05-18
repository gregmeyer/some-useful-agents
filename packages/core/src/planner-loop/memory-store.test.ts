import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlannerMemoryStore, tokeniseGoal } from './memory-store.js';
import type { BuildPlan } from '../build-plan-schema.js';

const trivialPlan: BuildPlan = {
  intent: 'agent',
  summary: 's',
  survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
  newAgents: [],
  questions: [],
  dashboard: null,
};

describe('tokeniseGoal', () => {
  it('lowercases + strips punctuation + drops short tokens', () => {
    expect(tokeniseGoal("Build me a Weather Agent! (forecast + alerts)")).toEqual(
      ['build', 'weather', 'agent', 'forecast', 'alerts'],
    );
  });

  it('returns empty array for noise-only input', () => {
    expect(tokeniseGoal('!!! ... ???')).toEqual([]);
    expect(tokeniseGoal('a an of in')).toEqual([]); // all < 3 chars
  });
});

describe('PlannerMemoryStore', () => {
  let dir: string;
  let store: PlannerMemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmem-test-'));
    store = new PlannerMemoryStore(join(dir, 'memory.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a committed plan', () => {
    store.recordCommit({ runId: 'r1', goal: 'weather agent', intent: 'agent', plan: trivialPlan, attempts: 1 });
    const all = store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      runId: 'r1',
      goal: 'weather agent',
      goalTokens: 'weather agent',
      intent: 'agent',
      attempts: 1,
      outcome: 'committed',
    });
    expect(all[0].plan).toEqual(trivialPlan);
  });

  it('listByIntent filters by intent and orders newest-first', () => {
    store.recordCommit({ runId: 'r1', goal: 'g1', intent: 'agent', plan: trivialPlan, attempts: 1 });
    store.recordCommit({ runId: 'r2', goal: 'g2', intent: 'dashboard-new', plan: { ...trivialPlan, intent: 'dashboard-new' } as BuildPlan, attempts: 1 });
    store.recordCommit({ runId: 'r3', goal: 'g3', intent: 'agent', plan: trivialPlan, attempts: 2 });

    const agents = store.listByIntent('agent');
    expect(agents.map((r) => r.runId)).toEqual(['r3', 'r1']); // newest first
    expect(store.listByIntent('dashboard-new').map((r) => r.runId)).toEqual(['r2']);
  });

  it('truncates oversized goals to 2KB on write', () => {
    store.recordCommit({ runId: 'r1', goal: 'x'.repeat(5000), intent: 'agent', plan: trivialPlan, attempts: 1 });
    expect(store.listAll()[0].goal.length).toBe(2048);
  });
});
