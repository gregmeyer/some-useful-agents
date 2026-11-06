import { describe, it, expect } from 'vitest';
import {
  frontPageDoc, gridDoc, checkBoardLayout, resolveBoardLayout, boardLayoutFlags, isComposedBoardDoc, boardDocBoundAgentIds, boardLayoutGuide, boardInRail,
  type BoardAgentShape,
} from './board-layout.js';
import { pageRhythm } from './notebook-layout.js';
import { validateBoardDoc, boardDocAgentIds, BoardsStore } from './boards.js';
import { applyBoardOps, describeBoardDoc } from './board-tree.js';
import { suaComponentDocs, boardComponentDocs } from './a2ui/catalog.js';
import { resolveLayout } from './layout-resolve.js';

// The Morning Brief as its agents' results shape it (names and kinds, never values).
const MORNING: BoardAgentShape[] = [
  { id: 'world-news-brief', title: 'World News', icon: 'newspaper', size: '2x2', kind: 'widget', ran: true, outputs: [{ name: 'lead_headline', type: 'string', length: 70 }, { name: 'lead_summary', type: 'string', length: 140 }, { name: 'national', type: 'list', length: 5 }, { name: 'world', type: 'list', length: 5 }] },
  { id: 'two-step-digest', title: 'Daily Digest', icon: '📰', size: '2x1', kind: 'widget', ran: true, outputs: [{ name: 'headlines', type: 'list', length: 10 }, { name: 'count', type: 'number' }, { name: 'summary', type: 'string', length: 20 }] },
  { id: 'weather-forecast', title: 'Weather', size: '2x1', kind: 'widget', ran: true, outputs: [{ name: 'temperature', type: 'string', length: 4 }, { name: 'temp_f', type: 'number' }, { name: 'humidity', type: 'number' }, { name: 'condition', type: 'string', length: 18 }, { name: 'location', type: 'string', length: 19 }] },
  { id: 'markets-today', title: 'Markets', size: '2x1', kind: 'comparison', ran: true, outputs: [{ name: 'headline', type: 'string', length: 7 }, { name: 'summary', type: 'string', length: 26 }, { name: 'nasdaq_change_pct', type: 'number' }, { name: 'dow_change_pct', type: 'number' }] },
  { id: 'multi-sport-scoreboard', title: 'Sports Scoreboard', icon: 'trophy', size: '2x1', kind: 'widget', ran: false, outputs: [] },
];
const ids = MORNING.map((a) => a.id);

// The data model as the board surface gets it: the board under /board.
const data = { board: {
  name: 'Morning Brief', date: 'Thursday 6 November', updated: '12m ago', agentIds: ids,
  statItems: [{ label: 'Count', value: '10', sub: 'Daily Digest' }, { label: 'Nasdaq change pct', value: '-8.17', sub: 'Markets' }],
  agents: {
    'world-news-brief': { title: 'World News', href: '/agents/world-news-brief', outputs: { lead_headline: 'Voters rebuke', lead_summary: 'Both chambers changed hands.', national: [{ headline: 'a' }], world: [] }, run: { status: 'completed', age: '12m ago' }, stats: {}, statItems: [] },
    'two-step-digest': { title: 'Daily Digest', href: '/agents/two-step-digest', outputs: { headlines: [{ title: 'x' }], count: 10, summary: '10 headlines loaded.' }, run: { status: 'completed', age: '1h ago' }, stats: { count: { value: '10', label: 'Count', note: 'Daily Digest · 1h ago' } }, statItems: [{ label: 'Count', value: '10' }] },
    'weather-forecast': { title: 'Weather', href: '/agents/weather-forecast', outputs: { temperature: '53°F', condition: 'Rain', location: 'Seattle' }, run: { status: 'completed', age: '2h ago' }, stats: {}, statItems: [] },
    'markets-today': { title: 'Markets', href: '/agents/markets-today', outputs: { headline: 'Markets', summary: 'NASDAQ -8.17%', nasdaq_change_pct: -8.17, dow_change_pct: -1.63 }, run: { status: 'completed', age: '30m ago' }, stats: { nasdaq_change_pct: { value: '-8.17', label: 'Nasdaq change pct', note: 'Markets · 30m ago' } }, statItems: [{ label: 'Nasdaq change pct', value: '-8.17' }] },
  },
} };

describe('the front page, filled for a board', () => {
  const page = frontPageDoc(MORNING);

  it('is a valid composed board document that reads like a front page', () => {
    const v = checkBoardLayout(page, ids);
    expect(v.ok, v.ok ? '' : v.errors.join('; ')).toBe(true);
    expect(isComposedBoardDoc(page)).toBe(true);
    expect(pageRhythm(page)).toEqual([]);
    const byId = new Map(page.map((c) => [c.id, c]));
    const root = byId.get('root')!.children as string[];
    expect(root[0]).toBe('masthead');
    expect(byId.get('masthead')).toMatchObject({ component: 'Panel', hero: true, treatment: 'feature', title: { path: '/board/name' }, note: { path: '/board/date' } });
    // The lead story: the agent with a headline, as a Callout bound to it.
    expect(root[1]).toBe('lede_world_news_brief');
    expect(byId.get('lede_world_news_brief')).toMatchObject({ treatment: 'lede', when: 'world-news-brief' });
    expect(byId.get('lede_world_news_brief_c')).toMatchObject({ component: 'Callout', text: { path: '/board/agents/world-news-brief/outputs/lead_headline' }, next: { path: '/board/agents/world-news-brief/outputs/lead_summary' } });
    // Story beside rail, 2:1: the agents that are numbers and facts (no lists) in the rail, a Lead over the tile when a number reads as one (a temperature, a change; not humidity or a count).
    expect(byId.get('top')).toMatchObject({ component: 'Columns', widths: [2, 1] });
    expect(byId.get('aside_weather_forecast_lead')).toMatchObject({ component: 'Lead', stat: { path: '/board/agents/weather-forecast/stats/temp_f' } });
    expect(byId.get('aside_markets_today_lead')).toMatchObject({ component: 'Lead', stat: { path: '/board/agents/markets-today/stats/nasdaq_change_pct' } });
    expect(byId.get('aside_markets_today_tile')).toMatchObject({ component: 'AgentTile', agentId: 'markets-today', chrome: 'bare' });
    // The digest carries a list (and a count): it's a story, not a figure. The lead agent's own tile goes last, as "More from".
    expect(byId.get('story')!.children).toEqual(['feature_two_step_digest', 'feature_multi_sport_scoreboard', 'feature_world_news_brief']);
    expect(byId.get('feature_world_news_brief')!.title).toBe('More from World News');
    expect(byId.get('feature_two_step_digest_lead')).toBeUndefined();
    // Two agents with a number that matters: a band of figures, at the end of the rail since the story column is longer.
    expect(root.at(-1)).toBe('top');
    expect(byId.get('rail')!.children).toEqual(['aside_weather_forecast', 'aside_markets_today', 'band']);
    expect(byId.get('band')).toMatchObject({ treatment: 'aside', when: 'numbers:weather-forecast' });
    // With a short story column, the band takes a full-width row of its own.
    const even = frontPageDoc(MORNING.filter((a) => a.id !== 'two-step-digest' && a.id !== 'multi-sport-scoreboard'));
    expect((even.find((c) => c.id === 'root')!.children as string[]).at(-1)).toBe('band');
    expect(even.find((c) => c.id === 'band')!.treatment).toBe('band');
    expect(byId.get('band_stats')).toMatchObject({ component: 'StatStrip', items: { path: '/board/statItems' } });
  });

  it('drops the parts of an agent that never ran, keeps a skeleton while one runs, and keeps the rest', () => {
    const flags = boardLayoutFlags(MORNING);
    expect(flags['multi-sport-scoreboard']).toBe(false);
    expect(flags['numbers:markets-today']).toBe(true);
    expect(flags['numbers:weather-forecast']).toBe(true);
    const drawn = resolveBoardLayout(page, flags, data);
    const drawnIds = drawn.map((c) => c.id);
    expect(drawnIds).not.toContain('feature_multi_sport_scoreboard');
    expect(drawnIds).toContain('lede_world_news_brief');
    expect(drawnIds).toContain('band');
    expect(drawn.find((c) => c.id === 'story')!.children).toEqual(['feature_two_step_digest', 'feature_world_news_brief']);
    expect(drawn.every((c) => c.when === undefined)).toBe(true);
    expect(validateBoardDoc({ components: drawn }).ok).toBe(true);
    // A bound part with nothing yet goes; while its agent's run is going it stays, as a skeleton. (A tile part is never empty: it draws itself.)
    const blank = { board: { ...data.board, agents: { ...data.board.agents, 'world-news-brief': { ...data.board.agents['world-news-brief'], outputs: {} } } } };
    expect(resolveBoardLayout(page, flags, blank).map((c) => c.id)).not.toContain('lede_world_news_brief');
    const running = resolveBoardLayout(page, { ...flags, 'running:world-news-brief': true }, blank, { running: new Set(['world-news-brief']) });
    expect(running.find((c) => c.id === 'lede_world_news_brief')).toMatchObject({ pending: true });
    expect(running.find((c) => c.id === 'feature_multi_sport_scoreboard')).toBeUndefined();
  });

  it('refuses a when that names no agent of the board, and a part bound to a field with the wrong prop', () => {
    const bad = checkBoardLayout([{ id: 'root', component: 'Column', children: ['p'] }, { id: 'p', component: 'Panel', title: 'x', child: 't', when: 'someone-else' }, { id: 't', component: 'Text', text: 'y' }], ids);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('"when" must be an agent of this board');
    const wrong = checkBoardLayout([{ id: 'root', component: 'Column', children: ['l'] }, { id: 'l', component: 'Lead', number: { path: '/board/agents/markets-today/stats/x' } }], ids);
    expect(wrong.ok).toBe(false);
  });

  it('lays agents three abreast when none has numbers, and alone when there is one', () => {
    const none = frontPageDoc(MORNING.filter((a) => !boardInRail(a)));
    expect(none.find((c) => c.id === 'top')).toMatchObject({ component: 'Columns', widths: [1, 1, 1] });
    expect(checkBoardLayout(none, ids).ok).toBe(true);
    const one = frontPageDoc([MORNING[2]]);
    expect(one.find((c) => c.id === 'root')!.children).toEqual(['masthead', 'aside_weather_forecast']);
    expect(pageRhythm(one)).toEqual([]);
  });
});

describe('a composed page as a board document', () => {
  const page = frontPageDoc(MORNING);

  it('validates as a board (its when and bindings kept), names its bound agents, and survives a store round trip with its meta', () => {
    const v = validateBoardDoc({ components: page });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.doc.components.find((c) => c.id === 'lede_world_news_brief')!.when).toBe('world-news-brief');
    expect(boardDocBoundAgentIds(page).sort()).toEqual(ids.sort());
    expect(boardDocAgentIds({ components: page })).toContain('world-news-brief');
    const store = new BoardsStore(':memory:');
    store.saveDoc({ id: 'user:mb', name: 'Morning Brief', doc: { components: gridDoc(MORNING) } });
    const saved = store.saveDoc({ id: 'user:mb', name: 'Morning Brief', doc: { components: page }, meta: { preset: 'front-page', layoutBy: 'picked' }, expectedVersion: 1 });
    expect(saved.layoutMeta).toEqual({ preset: 'front-page', layoutBy: 'picked' });
    expect(saved.doc!.components.some((c) => c.when !== undefined)).toBe(true);
    // Saved again without meta: a composed page keeps it; a plain grid loses it. Undo brings both back.
    expect(store.saveDoc({ id: 'user:mb', name: 'Morning Brief', doc: { components: page }, expectedVersion: 2 }).layoutMeta).toEqual({ preset: 'front-page', layoutBy: 'picked' });
    expect(store.saveDoc({ id: 'user:mb', name: 'Morning Brief', doc: { components: gridDoc(MORNING) }, expectedVersion: 3 }).layoutMeta).toBeUndefined();
    const back = store.undo('user:mb');
    expect(back.layoutMeta).toEqual({ preset: 'front-page', layoutBy: 'picked' });
    expect(back.doc!.components.find((c) => c.id === 'masthead')).toBeTruthy();
  });

  it('keeps its Panels and Columns through the tree operations, and the outline says what they are', () => {
    const { doc } = applyBoardOps({ components: page }, [{ op: 'set', id: 'band', props: { title: 'Figures' } }, { op: 'move', id: 'aside_markets_today', parent: 'story', index: 0 }]);
    const byId = new Map(doc.components.map((c) => [c.id, c]));
    expect(byId.get('band')!.title).toBe('Figures');
    expect(byId.get('story')!.children).toEqual(['aside_markets_today', 'feature_two_step_digest', 'feature_multi_sport_scoreboard', 'feature_world_news_brief']);
    expect(byId.get('top')!.component).toBe('Columns');
    expect(doc.components.length).toBe(page.length);
    const outline = describeBoardDoc(doc, (id) => MORNING.find((a) => a.id === id)?.title);
    expect(outline).toContain('[masthead] panel "/board/name" (feature, hero)');
    expect(outline).toContain('[top] columns 2:1');
    expect(outline).toContain('[lede_world_news_brief_c] callout bound to world-news-brief');
    expect(outline).toContain('[when world-news-brief]');
  });

  it('describes the data, this board\'s fields and the rules for sua', () => {
    const guide = boardLayoutGuide([...suaComponentDocs(), ...boardComponentDocs()], MORNING);
    expect(guide).toContain('/board/agents/<id>/outputs/<field>');
    expect(guide).toContain('markets-today ("Markets", comparison): headline (string 7), summary (string 26), nasdaq_change_pct (number)');
    expect(guide).toContain('multi-sport-scoreboard ("Sports Scoreboard", widget, not run yet): no fields seen yet');
    expect(guide).toContain('- AgentTile:');
    expect(guide).toContain('"chrome": "bare"');
  });
});

describe('the generic resolver', () => {
  it('resolves a layout under any prefix: when flags, layout values, empty parts', () => {
    const components = [
      { id: 'root', component: 'Column', children: ['a', 'b', 'c'] },
      { id: 'a', component: 'Panel', title: 'A', child: 'a_t', when: 'x' },
      { id: 'a_t', component: 'Text', text: { path: '/thing/words' } },
      { id: 'b', component: 'Panel', title: { path: '/thing/layout/title' }, child: 'b_t' },
      { id: 'b_t', component: 'Text', text: { path: '/thing/nothing' } },
      { id: 'c', component: 'Text', text: 'kept' },
    ];
    const out = resolveLayout(components, { prefix: '/thing', flags: { x: true }, values: { title: 'B!' }, data: { thing: { words: 'hi', nothing: '' } } });
    expect(out.map((c) => c.id)).toEqual(['root', 'a', 'a_t', 'c']);
    const off = resolveLayout(components, { prefix: '/thing', flags: { x: false }, values: { title: 'B!' } });
    expect(off.map((c) => c.id)).toEqual(['root', 'b', 'b_t', 'c']);
    expect(off.find((c) => c.id === 'b')!.title).toBe('B!');
  });
});
