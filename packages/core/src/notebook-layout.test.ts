import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { NotebookStore } from './notebooks.js';
import { checkNotebookLayout, describeLayoutChange, notebookLayoutGuide, cleanLayout, notebookLayoutOf, resolveNotebookLayout, splitNotebookHeader, pageRhythm, layoutPreset, DEFAULT_NOTEBOOK_LAYOUT, NOTEBOOK_LAYOUT_PRESETS } from './notebook-layout.js';
import type { ViewComponent } from './a2ui/view.js';

let dir: string | undefined;
let runs: RunStore | undefined;
afterEach(() => { runs?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; runs = undefined; });

/** A small briefing-like page: any catalog components, bound to the notebook. */
const page: ViewComponent[] = [
  { id: 'root', component: 'Column', children: ['head', 'pair', 'only_decided'] },
  { id: 'head', component: 'Callout', label: 'The briefing', text: { path: '/notebook/summary' } },
  { id: 'pair', component: 'Columns', children: ['facts', 'map_panel', 'chart'], widths: [1, 2, 3] },
  { id: 'facts', component: 'KeyValue', items: { path: '/notebook/statItems' } },
  { id: 'map_panel', component: 'Panel', title: 'Where they sit', child: 'map', note: { path: '/notebook/layout/mapNote' }, when: 'map' },
  { id: 'map', component: 'Scatter', points: { path: '/notebook/options' }, x: 'measure', y: 'price', xLabel: { path: '/notebook/layout/xLabel' }, xBetter: { path: '/notebook/layout/xBetter' } },
  { id: 'chart', component: 'Funnel', stages: { path: '/notebook/funnel' }, when: '!decided' },
  { id: 'only_decided', component: 'Column', children: ['decision'], when: 'decided' },
  { id: 'decision', component: 'Text', text: 'Decided' },
];

describe('notebook layouts (A2UI documents)', () => {
  it('draw for one notebook: whens hold or the parts go, widths follow, layout settings fill in', () => {
    const none = resolveNotebookLayout(page, {}, {});
    expect(none.map((c) => c.id)).toEqual(['root', 'head', 'pair', 'facts', 'chart']);
    expect(none.find((c) => c.id === 'pair')).toEqual({ id: 'pair', component: 'Columns', children: ['facts', 'chart'], widths: [1, 3] });
    expect(none.find((c) => c.id === 'root')!.children).toEqual(['head', 'pair']);

    const all = resolveNotebookLayout(page, { map: true, decided: true }, { mapNote: 'price by miles', xLabel: 'Miles' });
    expect(all.find((c) => c.id === 'pair')).toMatchObject({ children: ['facts', 'map_panel'], widths: [1, 2] });
    expect(all.find((c) => c.id === 'map_panel')).toEqual({ id: 'map_panel', component: 'Panel', title: 'Where they sit', child: 'map', note: 'price by miles' });
    // A setting the notebook doesn't have is left off.
    expect(all.find((c) => c.id === 'map')).toEqual({ id: 'map', component: 'Scatter', points: { path: '/notebook/options' }, x: 'measure', y: 'price', xLabel: 'Miles' });
    expect(all.find((c) => c.id === 'root')!.children).toEqual(['head', 'pair', 'only_decided']);

    // One left in a row takes it all.
    const one = resolveNotebookLayout(page.map((c) => (c.id === 'facts' ? { ...c, when: 'options' } : c)), { decided: true }, {});
    expect(one.find((c) => c.id === 'pair')).toBeUndefined();
  });

  it('check a layout as a valid A2UI view, with known flags only', () => {
    expect(checkNotebookLayout(page).ok).toBe(true);
    expect(checkNotebookLayout(DEFAULT_NOTEBOOK_LAYOUT.components).ok).toBe(true);
    expect(checkNotebookLayout([{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Text', text: 'hi', when: 'sunny' }]))
      .toEqual({ ok: false, errors: ['x: "when" must be one of map, funnel, steps, options, decided, about, person, company, competitors, affiliations, answered, planned (or !one).'] });
    expect(checkNotebookLayout([{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Nope' }]).ok).toBe(false);
    expect(checkNotebookLayout('no').ok).toBe(false);
    expect(cleanLayout('shortlist')).toBe(DEFAULT_NOTEBOOK_LAYOUT);
    expect(cleanLayout({ preset: 'shortlist' })).toBe(DEFAULT_NOTEBOOK_LAYOUT);
    expect(cleanLayout('nope')).toBeUndefined();
    expect(cleanLayout({ preset: 'shortlist', components: page })).toEqual({ preset: 'shortlist', components: page });
    expect(notebookLayoutOf({})).toBe(DEFAULT_NOTEBOOK_LAYOUT);
    expect(NOTEBOOK_LAYOUT_PRESETS.map((p) => p.id)).toEqual(['shortlist', 'dossier', 'answer', 'plan', 'watch']);
    // Every ready-made page is a page that checks out.
    for (const p of NOTEBOOK_LAYOUT_PRESETS) expect(checkNotebookLayout(p.layout.components), p.id).toMatchObject({ ok: true });
  });

  it('a notebook keeps its layout, can go back to the default, and a template carries it', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nb-layout-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Find a used car' });
    expect(nb.layout).toBeUndefined();
    expect(s.setLayout(nb.id, { components: page }).layout).toEqual({ components: page });
    expect(s.get(nb.id)!.layout).toEqual({ components: page });
    expect(s.saveTemplate('Car search', nb.id).setup.layout).toEqual({ components: page });
    expect(() => s.setLayout(nb.id, { components: [{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Text', text: 'hi', when: 'sunny' }] }))
      .toThrow('That layout can\'t be drawn: x: "when" must be one of map, funnel, steps, options, decided, about, person, company, competitors, affiliations, answered, planned (or !one).');
    expect(s.setLayout(nb.id, null).layout).toBeUndefined();
    expect(s.saveTemplate('Car search', nb.id).setup.layout).toBeUndefined();
  });

  it('keep what a change replaced, to undo to', () => {
    dir = mkdtempSync(join(tmpdir(), 'sua-nb-layout-'));
    runs = new RunStore(join(dir, 'runs.db'));
    const s = NotebookStore.fromHandle(runs.databaseHandle());
    const nb = s.create({ title: 'Prepare for a meeting' });
    expect(s.layoutUndos(nb.id)).toBe(0);
    expect(s.undoLayout(nb.id)).toBe(false);
    s.setLayout(nb.id, { components: page }, 'sua');
    const two = page.map((c) => (c.id === 'head' ? { ...c, label: 'Who they are' } : c));
    s.setLayout(nb.id, { components: two }, 'sua');
    s.setLayout(nb.id, { components: two }, 'sua'); // the same again: nothing to undo to
    expect(s.layoutUndos(nb.id)).toBe(2);
    expect(s.undoLayout(nb.id)).toBe(true);
    expect(s.get(nb.id)!.layout).toEqual({ components: page });
    expect(s.undoLayout(nb.id)).toBe(true);
    expect(s.get(nb.id)!.layout).toBeUndefined();
    expect(s.layoutUndos(nb.id)).toBe(0);
  });

  it('say what a change does, and tell sua how to draw a page', () => {
    const after = { components: [
      ...page.filter((c) => c.id !== 'chart').map((c) => (c.id === 'root' ? { ...c, children: ['pair', 'head', 'only_decided', 'who'] } : c.id === 'pair' ? { ...c, children: ['facts', 'map_panel'], widths: [1, 2] } : c)),
      { id: 'who', component: 'Callout', label: 'Who they are', text: { path: '/notebook/statement' } },
    ] };
    expect(describeLayoutChange({ components: page }, after)).toEqual([
      { what: 'top to bottom', before: 'head → pair → only_decided', after: 'pair → head → only_decided → who' },
      { what: 'adds', before: '—', after: 'Callout “Who they are”' },
      { what: 'removes', before: '—', after: 'Funnel' },
      { what: 'changes', before: '—', after: 'Column, Columns' },
    ]);
    expect(describeLayoutChange({ components: page }, { components: page })).toEqual([{ what: 'layout', before: '—', after: 'no change' }]);
    const guide = notebookLayoutGuide([{ name: 'Callout', summary: 'A highlighted paragraph. More.' }]);
    expect(guide).toContain('- /notebook/options: Options, best first');
    expect(guide).toContain('- map: It has a price and a measure');
    expect(guide).toContain('- sort: The shortlist');
    expect(guide).toContain('- Callout: A highlighted paragraph.');
  });
});


describe('a page\'s length and header', () => {
  const page: ViewComponent[] = [
    { id: 'root', component: 'Column', children: ['header', 'top', 'said'] },
    { id: 'header', component: 'NotebookHeader', subtitle: 'Meeting briefing', steps: 'fold', side: 'glance' },
    { id: 'glance', component: 'Agenda', points: { path: '/notebook/talkingPoints' }, maxQuestions: 9 },
    { id: 'top', component: 'Columns', children: ['said_short', 'time'], widths: [2, 1] },
    { id: 'said_short', component: 'QuoteList', items: { path: '/notebook/quotes' }, maxItems: 30 },
    { id: 'time', component: 'Timeline', events: { path: '/notebook/timeline' } },
    { id: 'said', component: 'QuoteList', items: { path: '/notebook/quotes' }, when: 'options' },
  ];

  it('cuts every list part to a few rows: a default when the page doesn\'t say, at most a cap when it does', () => {
    const r = new Map(resolveNotebookLayout(page, { options: true }, {}).map((c) => [c.id, c]));
    expect(r.get('said_short')!.maxItems).toBe(6);
    expect(r.get('said')!.maxItems).toBe(4);
    expect(r.get('time')!.maxItems).toBe(6);
    expect(r.get('glance')!.maxQuestions).toBe(5);
    // The shortlist is drawn as before: its timeline already says 8, and its grid isn't cut.
    const short = new Map(resolveNotebookLayout(DEFAULT_NOTEBOOK_LAYOUT.components, { options: true }, {}).map((c) => [c.id, c]));
    expect(short.get('timeline')!.maxItems).toBe(8);
    expect(short.get('shortlist')!.maxItems).toBeUndefined();
  });

  it('takes the header and its side part out of the page; the side is a small page of its own', () => {
    expect(checkNotebookLayout(page).ok).toBe(true);
    const { header, side, rest } = splitNotebookHeader(resolveNotebookLayout(page, { options: true }, {}));
    expect(header).toMatchObject({ id: 'header', subtitle: 'Meeting briefing', steps: 'fold', side: 'glance' });
    expect(side!.map((c) => c.id)).toEqual(['root', 'glance']);
    expect(side![0]).toEqual({ id: 'root', component: 'Column', children: ['glance'] });
    expect(rest.map((c) => c.id)).toEqual(['root', 'top', 'said_short', 'time', 'said']);
    expect(rest[0].children).toEqual(['top', 'said']);
    // No header: the page as it is.
    expect(splitNotebookHeader(DEFAULT_NOTEBOOK_LAYOUT.components).header).toBeUndefined();
    // A side part whose `when` doesn't hold: the header goes without it.
    const gated = page.map((c) => (c.id === 'glance' ? { ...c, when: 'decided' } : c));
    expect(splitNotebookHeader(resolveNotebookLayout(gated, { options: true }, {})).header!.side).toBeUndefined();
  });

  it('refuses two headers, and a side that isn\'t on the page', () => {
    expect(checkNotebookLayout([...page, { id: 'h2', component: 'NotebookHeader' }])).toEqual({ ok: false, errors: ['A page has at most one NotebookHeader.'] });
    const v = checkNotebookLayout(page.map((c) => (c.id === 'header' ? { ...c, side: 'nope' } : c)));
    expect(v).toEqual({ ok: false, errors: ['header: its side "nope" isn\'t a component of the page.'] });
  });

  it('tells sua to vary the page and how to shape the header', () => {
    const g = notebookLayoutGuide([{ name: 'QuoteList', summary: 'Quotes.', example: { id: 'q', component: 'QuoteList', items: { path: '/notebook/quotes' }, maxItems: 4 } }]);
    expect(g).toContain('never two long lists stacked at the top');
    expect(g).toContain('put a NotebookHeader first in root\'s children');
    expect(g).toContain('- QuoteList: Quotes. Props, e.g. {"items":{"path":"/notebook/quotes"},"maxItems":4}');
  });
});

describe('editorial pages', () => {
  it('a meeting briefing (dossier) reads well, and its parts wait for what they show', () => {
    const dossier = layoutPreset('dossier')!.layout.components;
    expect(checkNotebookLayout(dossier).ok).toBe(true);
    expect(pageRhythm(dossier)).toEqual([]);
    // Before anything is learned: no cover row, no company aside; what to talk about takes the row.
    const early = new Map(resolveNotebookLayout(dossier, { options: true }, {}).map((c) => [c.id, c]));
    expect(early.has('cover_row')).toBe(false);
    expect(early.get('talk_row')).toMatchObject({ children: ['agenda_p'], widths: [1] });
    // Once the person and company are known, both rows are there.
    const known = new Map(resolveNotebookLayout(dossier, { options: true, about: true, person: true, company: true }, {}).map((c) => [c.id, c]));
    expect(known.get('cover_row')!.children).toEqual(['who_p', 'facts_p']);
    expect(known.get('who')).toMatchObject({ variant: 'cover', quote: { path: '/notebook/leadQuote' } });
  });

  it('says where a drawn page reads like a grid', () => {
    const frame = (id: string, child: string, treatment?: string) => ({ id, component: 'Panel', title: id, child, ...(treatment ? { treatment } : {}) });
    const grid = [
      { id: 'root', component: 'Column', children: ['r1', 'r2', 'r3', 'g'] },
      { id: 'r1', component: 'Columns', children: ['a', 'b'], widths: [1, 1] },
      { id: 'r2', component: 'Columns', children: ['c', 'd'], widths: [2, 2] },
      { id: 'r3', component: 'Columns', children: ['e', 'f'], widths: [5, 1] },
      frame('a', 'ta'), frame('b', 'tb'), frame('c', 'tc'), frame('d', 'td', 'lede'), frame('e', 'q', 'aside'), frame('f', 'tf', 'lede'), frame('g', 'tg'),
      ...['ta', 'tb', 'tc', 'td', 'tf', 'tg'].map((id) => ({ id, component: 'Text', text: 'x' })),
      { id: 'q', component: 'QuoteList', items: [] },
    ];
    expect(pageRhythm(grid)).toEqual([
      '4 parts are framed (plain); at most 3. Give the others a treatment: lede, feature, aside or band.',
      '2 ledes (d, f); a page has one.',
      'e is an aside holding a QuoteList; long lists go in a feature or a fold.',
      'r3 puts a short part (f) beside a long one (e), which leaves a hole under f. Pair f with facts or other short parts, and give e a row or a column of its own.',
      'r2 has the same shape (1:1) as the row before it; vary them.',
      'r3 is 5:1; rows are full width, 2:1, 1:2, 3:2, 2:3, 1:1 or 1:1:1.',
    ]);
  });
});

describe('balance', () => {
  it('says when a short part sits beside a long one, and the Meeting briefing is balanced', () => {
    const page = [
      { id: 'root', component: 'Column', children: ['row'] },
      { id: 'row', component: 'Columns', children: ['who_p', 'talk_p'], widths: [3, 2] },
      { id: 'who_p', component: 'Panel', title: 'Who', child: 'who', treatment: 'lede' },
      { id: 'who', component: 'ProfileCard', name: 'Dana' },
      { id: 'talk_p', component: 'Panel', title: 'Talk', child: 'talk', treatment: 'feature' },
      { id: 'talk', component: 'Agenda', points: [] },
    ];
    expect(pageRhythm(page)).toEqual(['row puts a short part (who_p) beside a long one (talk_p), which leaves a hole under who_p. Pair who_p with facts or other short parts, and give talk_p a row or a column of its own.']);
    expect(pageRhythm(layoutPreset('dossier')!.layout.components)).toEqual([]);
  });
});
