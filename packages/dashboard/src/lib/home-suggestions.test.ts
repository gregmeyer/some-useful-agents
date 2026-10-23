import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { pickSuggestions, needsInputs } from './home-suggestions.js';

// Home's Try next: agents you can run in one click, and questions for sua from what happened today.

const NOW = Date.parse('2026-10-22T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const agent = (id: string, over: Partial<Agent> = {}): Agent => ({ id, name: id.toUpperCase(), status: 'active', source: 'local', mcp: false, nodes: [], description: `${id} does a thing`, ...over } as Agent);
const pick = (agents: Agent[], over: Partial<Parameters<typeof pickSuggestions>[0]> = {}) => pickSuggestions({
  agents, lastRunAt: new Map(), runCounts: new Map(), notebookIdeas: [], failedToday: 0, ranToday: 0, now: NOW, ...over,
});

describe('Try next', () => {
  it('suggests agents you can run in one click: not sua\'s own, not demos, nothing required to fill in', () => {
    const agents = [
      agent('weather'),
      agent('needs-city', { inputs: { CITY: { type: 'string' } } } as Partial<Agent>),
      agent('has-default', { inputs: { CITY: { type: 'string', default: 'Seattle' } } } as Partial<Agent>),
      agent('smoke-test'),
      agent('inbox-triage'),
      agent('page-facts', { inputs: { PAGE_URL: { type: 'string', default: '' } } } as Partial<Agent>),
      agent('empty-list', { inputs: { ITEMS: { type: 'string', default: '' } } } as Partial<Agent>),
      agent('paused', { status: 'paused' }),
    ];
    expect(pick(agents).agents.map((a) => a.id)).toEqual(['weather', 'has-default']);
    expect(needsInputs({ inputs: { X: { type: 'string', required: false } } } as never)).toBe(false);
  });

  it('puts your go-tos that have not run today first, then ones used this week', () => {
    const agents = [agent('a'), agent('b'), agent('c'), agent('d')];
    const lastRunAt = new Map([['a', ago(2)], ['b', ago(30)], ['c', ago(48)]]);
    const runCounts = new Map([['a', 9], ['b', 5]]);
    // a ran 2h ago: it waits; b is a go-to that hasn't run today; c was used this week; d never ran.
    expect(pick(agents, { lastRunAt, runCounts }).agents.map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });

  it('asks about failures only after one, offers notebook ideas, and always has something to ask', () => {
    expect(pick([]).asks.map((a) => a.label)).toEqual(['What can sua do for me?', 'Build me an agent that checks something every morning']);
    const asks = pick([], { failedToday: 2, ranToday: 5, notebookIdeas: [{ label: 'Find a used road bike', text: 'Help me find a used road bike under $800' }] }).asks;
    expect(asks.map((a) => a.label)).toEqual(['Start a notebook: Find a used road bike', 'What failed today?', 'What did my agents do today?']);
    expect(asks[0].text).toBe('Help me find a used road bike under $800');
  });

  it('offers to schedule your top go-to when it has no schedule', () => {
    const asks = pick([agent('digest')], { runCounts: new Map([['digest', 4]]), lastRunAt: new Map([['digest', ago(30)]]) }).asks;
    expect(asks[0].label).toBe('Put DIGEST on a schedule');
  });
});
