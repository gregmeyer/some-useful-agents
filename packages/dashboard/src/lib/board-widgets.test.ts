import { describe, it, expect } from 'vitest';
import { RunStore, type Agent, type AgentSignal } from '@some-useful-agents/core';
import { asNumber, outputShapes, boardPageData, boardRefreshMs, fieldLabel } from './board-widgets.js';
import type { PulseTile } from '../views/pulse-types.js';

function tile(id: string, title: string, size?: string): PulseTile {
  const agent = { id, name: title, status: 'active', source: 'local', version: 1, nodes: [{ id: 'n1', type: 'shell', command: 'echo' }] } as Agent;
  return { agent, signal: { title, template: 'widget', ...(size ? { size } : {}) } as AgentSignal, slots: {} } as PulseTile;
}

/** A completed run whose one shell step printed `result`. */
function ran(store: RunStore, agentName: string, result: string, at: string): PulseTile['lastRun'] {
  const id = `run-${agentName}`;
  store.createRun({ id, agentName, status: 'completed', startedAt: at, completedAt: at, result, triggeredBy: 'cli' } as never);
  store.createNodeExecution({ runId: id, nodeId: 'n1', workflowVersion: 1, status: 'completed', startedAt: at, completedAt: at, result, outputsJson: JSON.stringify({ result }) } as never);
  return store.getRun(id)!;
}

describe('a board\'s data model', () => {
  it('reads numbers as numbers and leaves units alone', () => {
    expect(asNumber(-8.17)).toBe(-8.17);
    expect(asNumber('10')).toBe(10);
    expect(asNumber('$1,200')).toBe(1200);
    expect(asNumber('12%')).toBe(12);
    expect(asNumber('53°F')).toBeUndefined();
    expect(asNumber('Patchy rain')).toBeUndefined();
    expect(fieldLabel('nasdaq_change_pct')).toBe('Nasdaq change pct');
    expect(outputShapes({ headlines: [1, 2], count: 10, summary: 'ten', meta: { a: 1 }, result: 'raw' })).toEqual([
      { name: 'headlines', type: 'list', length: 2 }, { name: 'count', type: 'number' }, { name: 'summary', type: 'string', length: 3 }, { name: 'meta', type: 'object' },
    ]);
  });

  it('shapes each agent\'s latest result, run and numbers under /board, in the document\'s order', () => {
    const store = new RunStore(':memory:');
    const now = new Date('2026-11-06T15:00:00Z').getTime();
    const weather = tile('weather-forecast', 'Weather', '2x1');
    weather.lastRun = ran(store, 'weather-forecast', JSON.stringify({ temperature: '53°F', condition: 'Rain' }), new Date(now - 2 * 3_600_000).toISOString());
    const markets = tile('markets-today', 'Markets');
    markets.lastRun = ran(store, 'markets-today', JSON.stringify({ headline: 'Markets', nasdaq_change_pct: -8.17, dow_change_pct: -1.63 }), new Date(now - 30 * 60_000).toISOString());
    const scores = tile('multi-sport-scoreboard', 'Scores');
    const tiles = new Map([['weather-forecast', weather], ['markets-today', markets], ['multi-sport-scoreboard', scores]]);
    const page = boardPageData({ name: 'Morning Brief' }, tiles, { runStore: store, now }, ['markets-today']);
    expect(page.data.name).toBe('Morning Brief');
    expect(page.data.date).toBe('Friday 6 November');
    expect(page.data.agentIds).toEqual(['markets-today', 'weather-forecast', 'multi-sport-scoreboard']);
    expect(page.data.updated).toMatch(/ ago$/);
    const m = page.data.agents['markets-today'];
    expect(m.outputs).toMatchObject({ headline: 'Markets', nasdaq_change_pct: -8.17 });
    expect(m.stats.nasdaq_change_pct).toMatchObject({ value: '-8.17', label: 'Nasdaq change pct', note: expect.stringMatching(/^Markets · /) });
    expect(m.statItems.map((s) => s.label)).toEqual(['Nasdaq change pct', 'Dow change pct']);
    expect(m.run).toMatchObject({ status: 'completed', running: false });
    expect(m.run.href).toMatch(/^\/runs\//);
    expect(page.data.agents['weather-forecast'].stats).toEqual({});
    expect(page.data.agents['multi-sport-scoreboard']).toMatchObject({ outputs: {}, run: { age: 'never', running: false } });
    expect(page.data.statItems.map((s) => s.sub)).toEqual(['Markets', 'Markets']);
    expect(page.flags).toMatchObject({ 'markets-today': true, 'numbers:markets-today': true, 'weather-forecast': true, 'numbers:weather-forecast': false, 'multi-sport-scoreboard': false });
    expect(page.shapes.find((s) => s.id === 'weather-forecast')).toMatchObject({ size: '2x1', kind: 'widget', outputs: [{ name: 'temperature', type: 'string', length: 4 }, { name: 'condition', type: 'string', length: 4 }] });
    expect(page.running.size).toBe(0);
    store.close();
  });

  it('refreshes on the shortest tile refresh, never under 10s', () => {
    expect(boardRefreshMs([{ refreshMs: 60_000 }, { refreshMs: 30_000 }, {}])).toBe(30_000);
    expect(boardRefreshMs([{ refreshMs: 2_000 }])).toBe(10_000);
    expect(boardRefreshMs([{}, {}])).toBe(0);
  });
});
