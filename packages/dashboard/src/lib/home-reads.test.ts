import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { noNews, pickReads, readLine } from './home-reads.js';
import { renderHomeReads } from '../views/home-reads.js';
import { render } from '../views/html.js';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const agent = (id: string, over: Partial<Agent> = {}): Agent => ({ id, name: id.toUpperCase(), status: 'active', source: 'local', mcp: false, nodes: [], schedule: '0 7 * * *', ...over } as Agent);

describe("Home's Today's reads", () => {
  it('a line per scheduled agent that produced something in the last day, newest first; not unscheduled, paused, sua\'s own, stale or empty ones', () => {
    const runs: Record<string, { id: string; startedAt: string; completedAt?: string; result?: string }> = {
      markets: { id: 'r1', startedAt: ago(5), completedAt: ago(5), result: '{"headline":"S&P up 0.4%","rows":[]}' },
      hn: { id: 'r2', startedAt: ago(2), completedAt: ago(2), result: 'Top story: a new SQLite release\nmore' },
      manual: { id: 'r3', startedAt: ago(1), completedAt: ago(1), result: 'ran by hand' },
      paused: { id: 'r4', startedAt: ago(1), completedAt: ago(1), result: 'x' },
      'inbox-triage': { id: 'r5', startedAt: ago(1), completedAt: ago(1), result: 'x' },
      stale: { id: 'r6', startedAt: ago(30), completedAt: ago(30), result: 'yesterday morning' },
      silent: { id: 'r7', startedAt: ago(1), completedAt: ago(1), result: '' },
    };
    const agents = [agent('markets'), agent('hn'), agent('manual', { schedule: undefined }), agent('paused', { status: 'paused' }), agent('inbox-triage'), agent('stale'), agent('silent'), agent('never')];
    const reads = pickReads(agents, (id) => runs[id] as never, NOW);
    expect(reads).toEqual([
      { agentId: 'hn', name: 'HN', runId: 'r2', at: ago(2), line: 'Top story: a new SQLite release' },
      { agentId: 'markets', name: 'MARKETS', runId: 'r1', at: ago(5), line: 'S&P up 0.4%' },
    ]);
    expect(pickReads(agents, (id) => runs[id] as never, NOW, 1)).toHaveLength(1);
  });

  it("says what the output is about, not its label: a short headline is followed by its summary or the first thing it lists", () => {
    const line = (o: unknown) => readLine(JSON.stringify(o));
    // A label for a headline, the news in the summary.
    expect(line({ headline: 'Markets', summary: 'NASDAQ -1.46%, DOW +0.89%', indices: [{ name: 'NASDAQ' }] })).toBe('Markets: NASDAQ -1.46%, DOW +0.89%');
    // A label and a list: the first story and how many more.
    expect(line({ headline: 'HN Top 5', count: 5, stories: [{ title: 'A new SQLite release' }, { title: 'b' }, { title: 'c' }, { title: 'd' }, { title: 'e' }] })).toBe('HN Top 5: A new SQLite release, and 4 more');
    // A headline that is the news stands alone.
    expect(line({ headline: 'No reminders to review', summary: 'No reminder data was provided.' })).toBe('No reminders to review');
    // No headline: the summary; else the list; else what it names, with its description.
    expect(line({ match_count: 6, summary: 'Six roles passed all checks.' })).toBe('Six roles passed all checks.');
    expect(line({ articles: [{ title: 'A new SQLite release', score: 354 }, { title: 'b' }] })).toBe('A new SQLite release, and 1 more');
    expect(line({ articles: [{ title: 'Only one' }] })).toBe('Only one');
    expect(line({ headline: 'Evening reset', items: [{ label: 'Clear the kitchen.' }, { label: 'b' }] })).toBe('Evening reset: Clear the kitchen, and 1 more');
    expect(line({ hero_name: 'Iron Fist', real_identity: 'Danny Rand', hero_index: 22, bio: 'Channels the heart of a dragon.' })).toBe('Iron Fist: Channels the heart of a dragon.');
    expect(line({ hero_name: 'Iron Fist', hero_index: 22 })).toBe('Iron Fist');
    // A metric, prose, a fenced object, and nothing, as before.
    expect(line({ label: 'Open PRs', value: 7 })).toBe('Open PRs: 7');
    expect(readLine('Top story: a new SQLite release\nmore')).toBe('Top story: a new SQLite release');
    expect(readLine('```json\n{"headline":"Weather","summary":"Rain by noon"}\n```')).toBe('Weather: Rain by noon');
    expect(readLine('')).toBeUndefined();
    // Long ones are cut.
    expect(line({ summary: 'x'.repeat(300) })!.length).toBe(150);
  });

  it("is high signal: one sentence each, only what's news, never the agent the brief already leads with", () => {
    const run = (id: string, o: unknown) => ({ id, startedAt: ago(2), completedAt: ago(2), result: typeof o === 'string' ? o : JSON.stringify(o) });
    const runs: Record<string, ReturnType<typeof run>> = {
      digest: run('r1', { match_count: 6, summary: 'Six roles passed all checks today, out of about 45 read. Three were newly posted. More follows.' }),
      prio: run('r2', { headline: 'No reminders to review', priority_count: 0, overdue_count: 0 }),
      quiet: run('r3', { matched_count: 0, summary: 'Searched five boards.' }),
      nothing: run('r4', 'Nothing new since yesterday.'),
      hn: run('r5', { headline: 'HN Top 5', count: 5, stories: [{ title: 'A new SQLite release' }, { title: 'b' }] }),
    };
    const agents = Object.keys(runs).map((id) => agent(id));
    const reads = pickReads(agents, (id) => runs[id] as never, NOW, 5, new Set(['hn']));
    expect(reads.map((r) => [r.agentId, r.line])).toEqual([['digest', 'Six roles passed all checks today, out of about 45 read']]);
    // Without the skip, the list agent's line is there, whole.
    expect(pickReads(agents, (id) => runs[id] as never, NOW).map((r) => r.agentId).sort()).toEqual(['digest', 'hn']);
    expect(noNews(runs.prio.result)).toBe(true);
    expect(noNews(runs.quiet.result)).toBe(true);
    expect(noNews(runs.nothing.result)).toBe(true);
    expect(noNews(runs.digest.result)).toBe(false);
    expect(noNews(JSON.stringify({ nasdaq_change_pct: -1.46, flat_pct: 0 }))).toBe(false);
    expect(noNews('Top story: a new SQLite release')).toBe(false);
    // A long sentence is cut to one line.
    const long = pickReads([agent('long')], () => run('r9', { summary: `${'word '.repeat(60)}.` }) as never, NOW);
    expect(long[0].line.length).toBeLessThanOrEqual(110);
  });

  it("draws nothing when there is nothing to read; else each name opens that agent's result in today's edition", () => {
    expect(render(renderHomeReads([])).trim()).toBe('');
    const page = render(renderHomeReads([{ agentId: 'hn top', name: 'HN', runId: 'r 2', at: new Date().toISOString(), line: 'Top <b>story</b>' }]));
    expect(page).toContain("Today's reads");
    expect(page).toContain('<a class="nbs__all" href="/pulse">Today\'s edition →</a>');
    expect(page).toContain('<a class="home-reads__name" href="/pulse#agent-hn%20top" title="Open HN\'s result in today\'s edition">HN</a>');
    expect(page).not.toContain('/runs/');
    expect(page).toContain('Top &lt;b&gt;story&lt;/b&gt;');
  });

});
