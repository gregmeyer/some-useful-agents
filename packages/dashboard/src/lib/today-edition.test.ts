import { describe, it, expect } from 'vitest';
import { checkBoardLayout, type Agent, type BoardAgentShape } from '@some-useful-agents/core';
import { editionAgents, editionDoc, editionWide } from './today-edition.js';

// Today's edition: the generated front page Pulse opens on.

const NOW = Date.parse('2026-11-11T18:00:00Z');
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const agent = (id: string, over: Partial<Agent> = {}) => ({ id, name: id, status: 'active', schedule: '0 8 * * *', ...over } as Agent);
const shape = (id: string, over: Partial<BoardAgentShape> = {}): BoardAgentShape => ({ id, title: id.toUpperCase(), outputs: [{ name: 'summary', type: 'string' }], ran: true, ...over });
const kids = (doc: { components: Array<Record<string, unknown>> }, id: string) => (doc.components.find((c) => c.id === id)?.children ?? []) as string[];

describe("Today's edition", () => {
  it('is the scheduled agents that finished a run in the last day, newest first, with the lead agent in front', () => {
    const runs: Record<string, { startedAt: string; completedAt?: string }> = {
      digest: { startedAt: ago(5), completedAt: ago(5) }, hn: { startedAt: ago(2), completedAt: ago(2) }, hero: { startedAt: ago(3) },
      stale: { startedAt: ago(30), completedAt: ago(30) }, manual: { startedAt: ago(1), completedAt: ago(1) }, paused: { startedAt: ago(1), completedAt: ago(1) }, 'inbox-triage': { startedAt: ago(1), completedAt: ago(1) },
    };
    const agents = [agent('digest'), agent('hn'), agent('hero'), agent('stale'), agent('manual', { schedule: undefined }), agent('paused', { status: 'paused' }), agent('inbox-triage'), agent('never')];
    const latest = (id: string) => runs[id];
    expect(editionAgents(agents, latest, NOW).map((a) => a.id)).toEqual(['hn', 'hero', 'digest']);
    expect(editionAgents(agents, latest, NOW, 'digest').map((a) => a.id)).toEqual(['digest', 'hn', 'hero']);
    // A lead that isn't in it changes nothing.
    expect(editionAgents(agents, latest, NOW, 'stale').map((a) => a.id)).toEqual(['hn', 'hero', 'digest']);
    expect(editionAgents([], latest, NOW)).toEqual([]);
  });

  it('a result needs the wide column when its view has a table or its tile asks for two rows', () => {
    expect(editionWide({ view: { components: [{ id: 'root', component: 'Column' }, { id: 't', component: 'Table' }] } as never }, {})).toBe(true);
    expect(editionWide({ view: { components: [{ id: 'root', component: 'Column' }, { id: 'm', component: 'Metric' }] } as never }, {})).toBe(false);
    expect(editionWide({}, { size: '2x2' })).toBe(true);
    expect(editionWide({}, { size: '2x1' })).toBe(false);
  });

  it('lays out a masthead, the day\'s headline, the wide results beside half of the others (numbers first), and the rest three abreast; every part checks out', () => {
    const shapes = [shape('digest'), shape('matches'), shape('hn'), shape('hero'), shape('prio'), shape('news'), shape('routine'), shape('markets', { outputs: [{ name: 'nasdaq_change_pct', type: 'number' }] })];
    const doc = editionDoc(shapes, { lede: { agentId: 'digest', headline: 'Six roles passed all checks' }, wide: new Set(['digest', 'matches']) });
    expect(checkBoardLayout(doc.components, shapes.map((s) => s.id))).toMatchObject({ ok: true });
    expect(kids(doc, 'root')).toEqual(['masthead', 'lede', 'top', 'more_0']);
    expect(doc.components.find((c) => c.id === 'lede_c')).toMatchObject({ component: 'Callout', text: 'Six roles passed all checks' });
    expect(doc.components.find((c) => c.id === 'lede')).toMatchObject({ title: 'DIGEST', treatment: 'lede', when: 'digest' });
    expect(doc.components.find((c) => c.id === 'top')).toMatchObject({ component: 'Columns', widths: [2, 1] });
    expect(kids(doc, 'story')).toEqual(['feature_digest', 'feature_matches']);
    // The one with a number leads the narrow column, its number set large over its result.
    expect(kids(doc, 'rail')).toEqual(['aside_markets', 'aside_hn', 'aside_hero']);
    expect(kids(doc, 'aside_markets_col')).toEqual(['aside_markets_lead', 'aside_markets_tile']);
    expect(doc.components.find((c) => c.id === 'aside_markets_lead')).toMatchObject({ component: 'Lead', stat: { path: '/board/agents/markets/stats/nasdaq_change_pct' } });
    expect(kids(doc, 'more_0')).toEqual(['plain_prio', 'plain_news', 'plain_routine']);
    // Each agent's result is its own view, bare, in a panel drawn once it has run.
    expect(doc.components.find((c) => c.id === 'feature_digest_tile')).toEqual({ id: 'feature_digest_tile', component: 'AgentTile', agentId: 'digest', chrome: 'bare' });
    expect(doc.components.find((c) => c.id === 'plain_news')).toMatchObject({ component: 'Panel', title: 'NEWS', when: 'news' });
    expect(doc.components.filter((c) => c.component === 'AgentTile').map((c) => c.agentId).sort()).toEqual(shapes.map((s) => s.id).sort());
  });

  it('with only narrow results they run three abreast; with only wide ones they stack; with no lead there is no lede', () => {
    const narrow = editionDoc([shape('a'), shape('b'), shape('c'), shape('d')]);
    expect(kids(narrow, 'root')).toEqual(['masthead', 'row_0', 'aside_d']);
    expect(kids(narrow, 'row_0')).toEqual(['aside_a', 'aside_b', 'aside_c']);
    const wide = editionDoc([shape('a'), shape('b')], { wide: new Set(['a', 'b']) });
    expect(kids(wide, 'root')).toEqual(['masthead', 'feature_a', 'feature_b']);
    // A lede for an agent that isn't in the edition isn't drawn.
    expect(kids(editionDoc([shape('a')], { lede: { agentId: 'gone', headline: 'x' } }), 'root')).toEqual(['masthead', 'aside_a']);
    for (const d of [narrow, wide]) expect(checkBoardLayout(d.components, ['a', 'b', 'c', 'd']).ok).toBe(true);
  });
});
