import { describe, it, expect } from 'vitest';
import {
  computeLayoutSuggestions,
  type LayoutSuggestionAgent,
  type CurrentLayout,
} from './layout-suggestions.js';

const NOW = new Date('2026-06-01T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const isoDaysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

function agent(partial: Partial<LayoutSuggestionAgent> & { id: string }): LayoutSuggestionAgent {
  return partial;
}

describe('computeLayoutSuggestions', () => {
  describe('static fillers', () => {
    it('returns six static pills when there are no agents (layout-quality first, then agent-curation)', () => {
      const out = computeLayoutSuggestions([], null, NOW);
      expect(out.length).toBe(6);
      expect(out.every((s) => s.dynamic === false)).toBe(true);
      const ids = out.map((s) => s.id);
      expect(ids).toEqual([
        'remove-gaps',
        'tables-scrollable',
        'compact-everything',
        'group-by-topic',
        'rank-by-reliability',
        'surface-daily',
      ]);
    });

    it('returns static pills when no dynamic conditions trigger', () => {
      const agents = [
        agent({ id: 'a1', title: 'Agent 1', lastRunAt: isoDaysAgo(1), successRate: 1.0, runCount30d: 30 }),
      ];
      const layout: CurrentLayout = { containers: [{ label: 'All', tiles: ['a1'] }] };
      const out = computeLayoutSuggestions(agents, layout, NOW);
      expect(out.every((s) => s.dynamic === false)).toBe(true);
      expect(out.length).toBe(6);
    });

    it('includes layout-quality pills (remove gaps / tables scrollable / compact) ahead of agent-curation pills', () => {
      const out = computeLayoutSuggestions([], null, NOW);
      const idsInOrder = out.map((s) => s.id);
      expect(idsInOrder.indexOf('remove-gaps')).toBeLessThan(idsInOrder.indexOf('group-by-topic'));
      expect(idsInOrder.indexOf('tables-scrollable')).toBeLessThan(idsInOrder.indexOf('rank-by-reliability'));
    });
  });

  describe('failing-agents pill', () => {
    it('emits when at least one agent has successRate < 0.5 and has run recently', () => {
      const agents = [
        agent({ id: 'flaky', successRate: 0.2, runCount30d: 10 }),
        agent({ id: 'fine', successRate: 0.95, runCount30d: 10 }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      const pill = out.find((s) => s.id === 'surface-failing');
      expect(pill).toBeDefined();
      expect(pill!.dynamic).toBe(true);
      expect(pill!.label).toContain('1 failing');
      expect(pill!.prompt).toContain('flaky');
      expect(pill!.prompt).not.toContain('fine');
    });

    it('does not emit when successRate is undefined (no run history)', () => {
      const agents = [agent({ id: 'never-run' })];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.find((s) => s.id === 'surface-failing')).toBeUndefined();
    });

    it('does not emit when runCount30d is 0 even with low successRate', () => {
      const agents = [agent({ id: 'old', successRate: 0, runCount30d: 0 })];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.find((s) => s.id === 'surface-failing')).toBeUndefined();
    });
  });

  describe('ungrouped-agents pill', () => {
    it('emits when 2+ agents are not in any container', () => {
      const agents = [
        agent({ id: 'a1', successRate: 1, runCount30d: 1 }),
        agent({ id: 'a2', successRate: 1, runCount30d: 1 }),
        agent({ id: 'a3', successRate: 1, runCount30d: 1 }),
      ];
      const layout: CurrentLayout = { containers: [{ label: 'Some', tiles: ['a3'] }] };
      const out = computeLayoutSuggestions(agents, layout, NOW);
      const pill = out.find((s) => s.id === 'group-ungrouped');
      expect(pill).toBeDefined();
      expect(pill!.label).toContain('2 ungrouped');
      expect(pill!.prompt).toContain('a1');
      expect(pill!.prompt).toContain('a2');
      expect(pill!.prompt).not.toContain('a3');
    });

    it('does not emit when only 1 agent is ungrouped', () => {
      const agents = [
        agent({ id: 'a1', successRate: 1, runCount30d: 1 }),
        agent({ id: 'a2', successRate: 1, runCount30d: 1 }),
      ];
      const layout: CurrentLayout = { containers: [{ label: 'Some', tiles: ['a2'] }] };
      const out = computeLayoutSuggestions(agents, layout, NOW);
      expect(out.find((s) => s.id === 'group-ungrouped')).toBeUndefined();
    });

    it('treats null layout as everything ungrouped', () => {
      const agents = [
        agent({ id: 'a1', successRate: 1, runCount30d: 1 }),
        agent({ id: 'a2', successRate: 1, runCount30d: 1 }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.find((s) => s.id === 'group-ungrouped')).toBeDefined();
    });
  });

  describe('stale-agents pill', () => {
    it('emits for agents that have not run in 30+ days', () => {
      const agents = [
        agent({ id: 'fresh', lastRunAt: isoDaysAgo(1) }),
        agent({ id: 'old', lastRunAt: isoDaysAgo(45) }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      const pill = out.find((s) => s.id === 'collapse-stale');
      expect(pill).toBeDefined();
      expect(pill!.prompt).toContain('old');
      expect(pill!.prompt).not.toContain('fresh');
    });

    it('does not count never-run agents as stale (no lastRunAt)', () => {
      const agents = [agent({ id: 'never' })];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.find((s) => s.id === 'collapse-stale')).toBeUndefined();
    });

    it('agents at exactly 30 days are not yet stale (strict greater-than)', () => {
      const agents = [agent({ id: 'edge', lastRunAt: isoDaysAgo(30) })];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.find((s) => s.id === 'collapse-stale')).toBeUndefined();
    });
  });

  describe('monitoring-cluster pill', () => {
    it('emits when 2+ agents look like monitoring tools (id or title)', () => {
      const agents = [
        agent({ id: 'api-monitor' }),
        agent({ id: 'system-health' }),
        agent({ id: 'daily-joke' }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      const pill = out.find((s) => s.id === 'cluster-monitoring');
      expect(pill).toBeDefined();
      expect(pill!.prompt).toContain('api-monitor');
      expect(pill!.prompt).toContain('system-health');
      expect(pill!.prompt).not.toContain('daily-joke');
    });

    it('matches by title when id is opaque', () => {
      const agents = [
        agent({ id: 'a1', title: 'API Monitor' }),
        agent({ id: 'a2', title: 'System Health' }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.find((s) => s.id === 'cluster-monitoring')).toBeDefined();
    });

    it('does not emit when only 1 monitoring-like agent exists', () => {
      const agents = [
        agent({ id: 'api-monitor' }),
        agent({ id: 'daily-joke' }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.find((s) => s.id === 'cluster-monitoring')).toBeUndefined();
    });
  });

  describe('ordering + caps', () => {
    it('returns at most 5 pills total', () => {
      // Trigger all 4 dynamic + plenty of static available.
      const agents = [
        agent({ id: 'flaky', successRate: 0.1, runCount30d: 10 }),
        agent({ id: 'lonely-1' }),
        agent({ id: 'lonely-2' }),
        agent({ id: 'stale-1', lastRunAt: isoDaysAgo(40) }),
        agent({ id: 'api-monitor-a' }),
        agent({ id: 'api-monitor-b' }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out.length).toBeLessThanOrEqual(6);
    });

    it('places dynamic pills before static fillers', () => {
      const agents = [
        agent({ id: 'flaky', successRate: 0.1, runCount30d: 10 }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      expect(out[0].dynamic).toBe(true);
      expect(out[0].id).toBe('surface-failing');
    });

    it('caps dynamic pills at 3 (with 4 triggered, the 4th drops)', () => {
      const agents = [
        agent({ id: 'flaky', successRate: 0.1, runCount30d: 10 }),
        agent({ id: 'lonely-1' }),
        agent({ id: 'lonely-2' }),
        agent({ id: 'stale-1', lastRunAt: isoDaysAgo(40) }),
        agent({ id: 'api-monitor-a' }),
        agent({ id: 'api-monitor-b' }),
      ];
      const out = computeLayoutSuggestions(agents, null, NOW);
      const dynamic = out.filter((s) => s.dynamic);
      expect(dynamic.length).toBe(3);
    });

    it('each pill has stable id, label, and non-empty prompt', () => {
      const agents = [agent({ id: 'flaky', successRate: 0.1, runCount30d: 10 })];
      const out = computeLayoutSuggestions(agents, null, NOW);
      for (const s of out) {
        expect(s.id).toBeTruthy();
        expect(s.label).toBeTruthy();
        expect(s.prompt.length).toBeGreaterThan(10);
        expect(typeof s.dynamic).toBe('boolean');
      }
    });

    it('id list truncates with "and N more" suffix when more than 6 ids', () => {
      const agents = Array.from({ length: 8 }, (_, i) => agent({ id: `lonely-${i}` }));
      const out = computeLayoutSuggestions(agents, null, NOW);
      const pill = out.find((s) => s.id === 'group-ungrouped');
      expect(pill).toBeDefined();
      expect(pill!.prompt).toMatch(/and \d+ more/);
    });
  });
});
