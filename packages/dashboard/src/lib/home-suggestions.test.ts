import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { pickSuggestions, needsInputs, runsWithInputs, inputLabel, askStarters } from './home-suggestions.js';

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

  it('says why each is suggested, what Run uses, and offers to run it with your own value', () => {
    const agents = [
      agent('router', { description: 'Routes data through different paths. Teaches flow control.' }),
      agent('monitor', { inputs: { TIMEOUT_SECONDS: { type: 'number', default: 10 }, TARGET_URL: { type: 'string', default: 'https://httpbin.org/get' } } } as Partial<Agent>),
      agent('digest'),
      agent('asker', { inputs: { QUESTION: { type: 'string', default: 'Which is lighter, a Kindle or a Kobo?' } } } as Partial<Agent>),
    ];
    const got = pick(agents, { runCounts: new Map([['digest', 4]]), lastRunAt: new Map([['digest', ago(30)]]) }).agents;
    // A tutorial comes after the other new ones.
    expect(got.map((a) => `${a.id}:${a.why}`)).toEqual(['digest:go-to', 'monitor:new', 'asker:new']);
    expect(got[1].runsWith).toEqual([{ label: 'target URL', value: 'https://httpbin.org/get' }, { label: 'timeout seconds', value: '10' }]);
    expect(got[1].ownAsk).toEqual({ label: 'Run it with your own target URL', text: 'Run MONITOR (monitor) with my own target URL. Ask me for it first.' });
    expect(got[0].runsWith).toEqual([]);
    expect(got[0].ownAsk.label).toBe("Ask sua what it's good for");
    // A setting (where it writes, how many) isn't what it's about.
    const digest = pick([agent('hn', { inputs: { OUTPUT_DIR: { type: 'string', default: '/tmp/hn' }, STORY_COUNT: { type: 'number', default: 5 } } } as Partial<Agent>)]).agents[0];
    expect(digest.ownAsk.label).toBe("Ask sua what it's good for");
    expect(pick([agents[0]]).agents[0].why).toBe('tutorial');
    expect(inputLabel('API_KEY_ID')).toBe('API key ID');
    expect(runsWithInputs({ inputs: { NOTE: { type: 'string', default: 'x'.repeat(120) } } } as never)[0].value).toHaveLength(90);
  });

  it('gives the Ask sua card starters for every verb, from what you use and what happened', () => {
    const none = askStarters({ agents: [], lastRunAt: new Map(), runCounts: new Map(), notebookIdeas: [], failedAgents: [], now: NOW });
    expect(none.map((r) => r.verb)).toEqual(['Run', 'Build', 'Fix', 'Look up']);
    expect(none.every((r) => r.pills.length > 0)).toBe(true);
    expect(none[2].pills.map((p) => p.label)).toEqual(['Check my agents for anything broken']);

    const agents = [
      agent('research', { name: 'Research a topic', inputs: { TOPIC: { type: 'string', default: 'x' }, DEPTH_DAYS: { type: 'number', default: 3 } } } as Partial<Agent>),
      agent('digest', { name: 'Daily digest' }),
      agent('broken', { name: 'Flaky feed' }),
    ];
    const got = askStarters({
      agents, now: NOW,
      lastRunAt: new Map([['research', ago(30)], ['digest', ago(40)]]), runCounts: new Map([['research', 5], ['digest', 4]]),
      notebookIdeas: [{ label: 'A used road bike', text: 'Help me find a used road bike under $800' }],
      failedAgents: ['broken', 'broken'],
    });
    const run = got[0].pills;
    expect(run[0]).toEqual({ label: 'Run Research a topic on …', text: 'Run Research a topic with topic: ' });
    expect(run.map((p) => p.label)).toContain('Run Daily digest');
    expect(got[1].pills.map((p) => p.label)).toContain('Put Research a topic on a schedule');
    expect(got[2].pills[0]).toEqual({ label: 'Why did Flaky feed fail?', text: 'Why did Flaky feed (broken) fail today, and can you fix it?' });
    expect(got[3].pills[0]).toEqual({ label: 'Help me find a used road bike', text: 'Help me find a used road bike under $800' });
  });
});
