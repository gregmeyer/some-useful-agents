import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BoardBuildStore, boardDocFromBuildPlan, extractBoardBuildPlan } from './board-build.js';
import { validateBoardDoc, sectionsFromBoardDoc } from './boards.js';

const plan = (layout: 'sections' | 'tabs') => ({
  name: 'Morning', summary: 'x', layout, missing: [],
  sections: [
    { title: 'Weather', tiles: [{ agentId: 'weather', span: 2 }, { agentId: 'ghost' }] },
    { title: 'Markets', tiles: [{ agentId: 'markets' }, { agentId: 'weather' }] },
    { title: 'Nothing', tiles: [{ agentId: 'ghost' }] },
  ],
});
const known = (id: string) => id !== 'ghost';

describe('boardDocFromBuildPlan', () => {
  it('builds stacked sections of tiles with spans, dropping unknown and repeated agents and empty sections', () => {
    const { doc, dropped, placed } = boardDocFromBuildPlan(plan('sections'), known);
    expect(validateBoardDoc(doc).ok).toBe(true);
    expect(placed).toEqual(['weather', 'markets']);
    expect(dropped).toEqual(['ghost', 'ghost']);
    expect(sectionsFromBoardDoc(doc)).toEqual([
      { title: 'Weather', agentIds: ['weather'], placements: { weather: { size: '2x1' } } },
      { title: 'Markets', agentIds: ['markets'], placements: { markets: { size: '1x1' } } },
    ]);
  });

  it('puts each section in a tab when the layout is tabs', () => {
    const { doc } = boardDocFromBuildPlan(plan('tabs'), known);
    expect(validateBoardDoc(doc).ok).toBe(true);
    const tabs = doc.components.find((c) => c.component === 'Tabs')!;
    expect((tabs.tabs as Array<{ title: string }>).map((t) => t.title)).toEqual(['Weather', 'Markets']);
    expect(sectionsFromBoardDoc(doc).map((s) => [s.title, s.agentIds])).toEqual([['Weather', ['weather']], ['Markets', ['markets']]]);
  });

  it('gives an empty board when nothing matches', () => {
    const { doc, placed } = boardDocFromBuildPlan(plan('sections'), () => false);
    expect(placed).toEqual([]);
    expect(doc.components).toEqual([{ id: 'root', component: 'Column', children: [] }]);
  });
});

describe('extractBoardBuildPlan', () => {
  it('reads <plan> JSON (also fenced or bare) and rejects bad plans', () => {
    const p = { name: 'X', sections: [{ title: 'A', tiles: [{ agentId: 'a' }] }] };
    expect(extractBoardBuildPlan(`Sure.\n<plan>${JSON.stringify(p)}</plan>`)).toMatchObject({ ok: true, plan: { name: 'X', layout: 'sections', missing: [] } });
    expect(extractBoardBuildPlan('```json\n' + JSON.stringify(p) + '\n```')).toMatchObject({ ok: true });
    expect(extractBoardBuildPlan('no plan here')).toMatchObject({ ok: false });
    expect(extractBoardBuildPlan('<plan>{"name":"X","sections":[{"title":"A","tiles":[{"agentId":"Bad Id"}]}]}</plan>')).toMatchObject({ ok: false });
  });
});

describe('BoardBuildStore', () => {
  it('records a build through its phases and finds the latest and unfinished ones', () => {
    const s = new BoardBuildStore(join(mkdtempSync(join(tmpdir(), 'sua-builds-')), 'runs.db'));
    const b = s.create('user:morning', 'a morning board');
    expect(b).toMatchObject({ phase: 'planning', placed: [], failed: [], missing: [] });
    expect(s.unfinished().map((x) => x.id)).toEqual([b.id]);
    s.update(b.id, { phase: 'done', detail: 'Ready', placed: ['a'], failed: ['b'], missing: [{ purpose: 'calendar' }], plannerRunId: 'r1' });
    expect(s.latestFor('user:morning')).toMatchObject({ phase: 'done', placed: ['a'], failed: ['b'], missing: [{ purpose: 'calendar' }], plannerRunId: 'r1' });
    expect(s.unfinished()).toEqual([]);
    s.close();
  });
});
