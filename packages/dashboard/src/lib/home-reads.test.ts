import { describe, it, expect } from 'vitest';
import type { Agent } from '@some-useful-agents/core';
import { pickReads } from './home-reads.js';
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

  it('draws nothing when there is nothing to read; else each name opens its run', () => {
    expect(render(renderHomeReads([])).trim()).toBe('');
    const page = render(renderHomeReads([{ agentId: 'hn', name: 'HN', runId: 'r 2', at: new Date().toISOString(), line: 'Top <b>story</b>' }]));
    expect(page).toContain("Today's reads");
    expect(page).toContain('<a class="home-reads__name" href="/runs/r%202">HN</a>');
    expect(page).toContain('Top &lt;b&gt;story&lt;/b&gt;');
  });
});
