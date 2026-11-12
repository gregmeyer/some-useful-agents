import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { figureLabel, figuresOf, numbersOf, pickBrief } from './home-brief.js';
import { renderHomeBrief } from '../views/home-brief.js';
import { render } from '../views/html.js';

// Home's brief: what scheduled agents found today, as numbers. Every number is in an agent's output.

const NOW = Date.parse('2026-11-11T18:00:00Z');
const at = (daysAgo: number, hour = 15) => new Date(Date.parse('2026-11-11T00:00:00Z') - daysAgo * 86_400_000 + hour * 3600_000).toISOString();
const agent = (id: string, name: string, over: Partial<Agent> = {}) => ({ id, name, status: 'active', schedule: '0 8 * * *', ...over } as Agent);
const runs = (id: string, outs: unknown[]) => outs.map((o, i) => ({ id: `${id}-${String(i)}`, startedAt: at(i), completedAt: at(i), result: typeof o === 'string' ? o : JSON.stringify(o) }));
const digest = (n: number, extra: Record<string, unknown> = {}) => ({ match_count: n, summary: `${['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][n]} roles passed all checks today, out of about 45 read. More detail follows.`, matches: Array.from({ length: n }, (_, i) => ({ title: `Role ${String(i)}`, url: `https://jobs.example/${String(i)}` })), sources: Array.from({ length: n }, () => 'x'), ...extra });
const markets = (nasdaq: number, dow: number) => ({ headline: 'Markets', summary: `NASDAQ ${String(nasdaq)}%`, nasdaq_change_pct: nasdaq, dow_change_pct: dow, indices: [{ name: 'NASDAQ' }, { name: 'DOW' }] });
const hn = (title: string) => ({ headline: 'HN Top 5', count: 5, stories: [{ title, url: 'https://news.example/1', score: 354 }, { title: 'b', url: 'https://news.example/2' }] });

const world = () => [
  { agent: agent('digest', 'Job Digest'), runs: runs('digest', [digest(6), digest(2), digest(5), digest(4)]) },
  { agent: agent('markets', 'Markets'), runs: runs('markets', [markets(-1.46, 0.89), markets(-3.56, 0.09), markets(-7.42, -2.27)]) },
  { agent: agent('hn', 'HN Classified'), runs: runs('hn', [hn('A new SQLite release'), hn('x'), hn('y')]) },
  { agent: agent('routine', 'Evening Routine'), runs: runs('routine', [{ item_count: 6, estimated_minutes: 60 }, { item_count: 6, estimated_minutes: 60 }, { item_count: 6, estimated_minutes: 45 }]) },
  { agent: agent('hero', 'Hero'), runs: runs('hero', [{ hero_name: 'Iron Fist', hero_index: 22 }, { hero_name: 'Thor', hero_index: 3 }, { hero_name: 'Hulk', hero_index: 9 }]) },
];

describe("Home's brief", () => {
  it('reads the numbers an output could mean as news, and names each from the output', () => {
    expect(numbersOf({ match_count: 6, hero_index: 22, estimated_minutes: 60, nasdaq_change_pct: -1.46, ok: true, name: 'x', nested: { n: 1 } })).toEqual([
      { key: 'match_count', value: 6, kind: 'count' }, { key: 'nasdaq_change_pct', value: -1.46, kind: 'percent' },
    ]);
    // A count is named for the list it counts; a percentage for what moved.
    expect(figureLabel('match_count', 6, digest(6))).toBe('matches');
    expect(figureLabel('matched_count', 1, { matched_count: 1 })).toBe('matched');
    expect(figureLabel('nasdaq_change_pct', -1.46, {})).toBe('NASDAQ');
    expect(figureLabel('consumer_confidence_pct', 3, {})).toBe('consumer confidence');
    expect(figureLabel('count', 4, { count: 4 })).toBe('items');
  });

  it("a figure is a number that changes from day to day, with its week; one that never changes is how the agent is set up, not news", () => {
    const fs = figuresOf(agent('digest', 'Job Digest'), runs('digest', [digest(6), digest(2), digest(5), digest(4)]));
    expect(fs).toEqual([{ agentId: 'digest', agent: 'Job Digest', runId: 'digest-0', key: 'match_count', label: 'matches', kind: 'count', value: 6, text: '6',
      days: [{ day: '2026-11-08', value: 4 }, { day: '2026-11-09', value: 5 }, { day: '2026-11-10', value: 2 }, { day: '2026-11-11', value: 6 }] }]);
    expect(figuresOf(agent('hn', 'HN'), runs('hn', [hn('a'), hn('b'), hn('c')]))).toEqual([]);
    expect(figuresOf(agent('routine', 'R'), runs('routine', [{ item_count: 6 }, { item_count: 6 }, { item_count: 6 }]))).toEqual([]);
    // Fewer than three days isn't a week; prose has no figures.
    expect(figuresOf(agent('new', 'New'), runs('new', [digest(6), digest(2)]))).toEqual([]);
    expect(figuresOf(agent('prose', 'P'), runs('prose', ['Just words.', 'More words.', 'Words.']))).toEqual([]);
    // Two runs on one day count once: the later one.
    const twice = [{ id: 'b', startedAt: at(0, 16), completedAt: at(0, 16), result: JSON.stringify(digest(6)) }, { id: 'a', startedAt: at(0, 9), completedAt: at(0, 9), result: JSON.stringify(digest(1)) }, ...runs('digest', [digest(0), digest(2), digest(5)]).slice(1)];
    expect(figuresOf(agent('digest', 'D'), twice)[0].days.map((d) => d.value)).toEqual([5, 2, 6]);
  });

  it("leads with the largest count found today under that agent's own first sentence; other agents' figures beside it; the top story from a list agent", () => {
    const b = pickBrief(world(), NOW)!;
    expect(b.headline).toBe('Six roles passed all checks today, out of about 45 read');
    expect(b.lead).toMatchObject({ agentId: 'digest', label: 'matches', text: '6', runId: 'digest-0' });
    expect(b.figures.map((f) => [f.agent, f.label, f.text])).toEqual([['Markets', 'NASDAQ', '-1.46%'], ['Markets', 'DOW', '+0.89%']]);
    expect(b.top).toEqual({ title: 'A new SQLite release', url: 'https://news.example/1', agent: 'HN Classified' });
    expect(b.agents).toBe(5);
    expect(b.at).toBe(at(0));
  });

  it('is nothing without a count that changes; ignores agents that are paused, unscheduled, sua\'s own or stale', () => {
    expect(pickBrief(world().filter((x) => x.agent.id !== 'digest'), NOW)).toBeUndefined();
    expect(pickBrief([], NOW)).toBeUndefined();
    const off = [
      { agent: agent('digest', 'D', { status: 'paused' }), runs: runs('digest', [digest(6), digest(2), digest(5)]) },
      { agent: agent('manual', 'M', { schedule: undefined }), runs: runs('manual', [digest(6), digest(2), digest(5)]) },
      { agent: agent('inbox-triage', 'T'), runs: runs('t', [digest(6), digest(2), digest(5)]) },
      { agent: agent('stale', 'S'), runs: runs('stale', [digest(6), digest(2), digest(5)]).map((r, i) => ({ ...r, startedAt: at(i + 3), completedAt: at(i + 3) })) },
    ];
    expect(pickBrief(off, NOW)).toBeUndefined();
    // A zero today doesn't lead.
    expect(pickBrief([{ agent: agent('digest', 'D'), runs: runs('digest', [digest(0), digest(2), digest(5)]) }], NOW)).toBeUndefined();
  });

  it('draws the lead number, its week as columns with today marked, each figure with a trend line that says its values, and safe links', () => {
    const page = render(renderHomeBrief(pickBrief(world(), NOW), new Date(NOW)));
    expect(page).toContain('<h2 class="home-brief__headline" id="home-brief-title">Six roles passed all checks today, out of about 45 read</h2>');
    expect(page).toContain('<span class="home-brief__lead-value">6</span>');
    expect((page.match(/class="home-brief__col[ "]/g) ?? []).length).toBe(4);
    expect(page).toMatch(/class="home-brief__col is-today" title="Wed 2026-11-11: 6 matches"/);
    expect(page).toContain('<span class="home-brief__col-day">Today</span>');
    expect(page).toContain('aria-label="NASDAQ, last 3 days: Mon -7.42%, Tue -3.56%, Wed -1.46%"');
    expect(page).toContain('<span class="home-brief__arrow" aria-hidden="true">▼</span>-1.46%');
    expect(page).toContain('<a href="https://news.example/1" target="_blank" rel="noopener noreferrer">A new SQLite release</a>');
    // It sends you to the reading: today's edition, and each figure to its agent's result there (not a run page).
    expect(page).toContain('<a class="btn btn--sm btn--primary" href="/pulse">Read today\'s edition</a>');
    expect(page).toContain('href="/pulse#agent-digest">Job Digest</a>');
    expect(page).toContain('<a class="home-brief__fig" href="/pulse#agent-markets"');
    expect(page).not.toContain('href="/runs/');
    expect(render(renderHomeBrief(undefined)).trim()).toBe('');
    // A top story that doesn't link to the web isn't linked.
    const odd = world().map((x) => (x.agent.id === 'hn' ? { ...x, runs: runs('hn', [{ stories: [{ title: 'bad', url: 'javascript:alert(1)' }] }]) } : x));
    expect(pickBrief(odd, NOW)!.top).toBeUndefined();
  });
});
