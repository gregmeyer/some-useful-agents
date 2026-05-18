import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlannerMemoryStore } from './memory-store.js';
import { findSimilarCommittedPlans, formatPriorPlansBlock } from './memory-retrieval.js';
import type { BuildPlan } from '../build-plan-schema.js';

const planFor = (intent: BuildPlan['intent'], newAgentIds: string[] = []): BuildPlan => ({
  intent,
  summary: 's',
  survey: { matchedAgents: [], missingFor: [], existingDashboards: [] },
  newAgents: newAgentIds.map((id) => ({ id, purpose: 'p', yaml: `id: ${id}\nname: ${id}\nnodes: [{id: a, type: shell, command: echo}]\n` })),
  questions: [],
  dashboard: null,
});

describe('findSimilarCommittedPlans', () => {
  let dir: string;
  let store: PlannerMemoryStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmem-ret-'));
    store = new PlannerMemoryStore(join(dir, 'memory.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty when memory is empty', () => {
    expect(findSimilarCommittedPlans(store, { goal: 'anything', intent: 'agent' })).toEqual([]);
  });

  it('returns empty when the query goal tokenises to nothing', () => {
    store.recordCommit({ runId: 'r1', goal: 'weather agent', intent: 'agent', plan: planFor('agent'), attempts: 1 });
    expect(findSimilarCommittedPlans(store, { goal: '!!! ???' })).toEqual([]);
  });

  it('filters by intent when supplied', () => {
    store.recordCommit({ runId: 'r1', goal: 'weather agent', intent: 'agent', plan: planFor('agent'), attempts: 1 });
    store.recordCommit({ runId: 'r2', goal: 'weather dashboard', intent: 'dashboard-new', plan: planFor('dashboard-new'), attempts: 1 });

    const results = findSimilarCommittedPlans(store, { goal: 'weather', intent: 'agent' });
    expect(results.map((r) => r.row.runId)).toEqual(['r1']);
  });

  it('ranks by Jaccard similarity, ties broken by fewer attempts', () => {
    // Query: { weather, agent, forecast } (3 tokens).
    // partial: { weather, agent, alerts } → 2/4 = 0.5 (lower Jaccard).
    // exact-slow + exact-fast: { weather, agent, forecast } → 3/3 = 1.0.
    store.recordCommit({ runId: 'partial', goal: 'weather agent alerts', intent: 'agent', plan: planFor('agent'), attempts: 1 });
    store.recordCommit({ runId: 'exact-slow', goal: 'weather agent forecast', intent: 'agent', plan: planFor('agent'), attempts: 3 });
    store.recordCommit({ runId: 'exact-fast', goal: 'weather agent forecast', intent: 'agent', plan: planFor('agent'), attempts: 1 });

    const results = findSimilarCommittedPlans(store, { goal: 'weather agent forecast', intent: 'agent', k: 3 });
    // 1.0 winners first, ties broken by attempts ASC → exact-fast then exact-slow → then partial at 0.5.
    expect(results.map((r) => r.row.runId)).toEqual(['exact-fast', 'exact-slow', 'partial']);
  });

  it('drops candidates below the similarity floor', () => {
    store.recordCommit({ runId: 'unrelated', goal: 'spotify playlist composer', intent: 'agent', plan: planFor('agent'), attempts: 1 });
    expect(findSimilarCommittedPlans(store, { goal: 'weather forecast', intent: 'agent' })).toEqual([]);
  });

  it('honours k', () => {
    for (let i = 0; i < 5; i++) {
      store.recordCommit({ runId: `r${i}`, goal: 'weather agent forecast', intent: 'agent', plan: planFor('agent'), attempts: 1 });
    }
    expect(findSimilarCommittedPlans(store, { goal: 'weather agent forecast', intent: 'agent', k: 2 })).toHaveLength(2);
  });

  it('falls back to all intents when intent is not supplied (first-attempt retrieval)', () => {
    store.recordCommit({ runId: 'a', goal: 'weather forecast', intent: 'agent', plan: planFor('agent'), attempts: 1 });
    store.recordCommit({ runId: 'd', goal: 'weather dashboard', intent: 'dashboard-new', plan: planFor('dashboard-new'), attempts: 1 });
    const results = findSimilarCommittedPlans(store, { goal: 'weather' });
    expect(results.map((r) => r.row.runId).sort()).toEqual(['a', 'd']);
  });
});

describe('formatPriorPlansBlock', () => {
  it('returns empty string for no candidates', () => {
    expect(formatPriorPlansBlock([])).toBe('');
  });

  it('renders a <priorPlans> block with one line per candidate', () => {
    const out = formatPriorPlansBlock([
      {
        row: {
          id: 1, runId: 'r1', goal: 'weather agent', goalTokens: 'weather agent',
          intent: 'agent', plan: planFor('agent', ['weather-now']),
          committedAt: '2026-05-18', outcome: 'committed', attempts: 1,
        },
        score: 0.85,
      },
    ]);
    expect(out).toContain('<priorPlans>');
    expect(out).toContain('</priorPlans>');
    expect(out).toContain('score=0.85');
    expect(out).toContain('attempts=1');
    expect(out).toContain('weather agent');
    expect(out).toContain('weather-now');
  });
});
