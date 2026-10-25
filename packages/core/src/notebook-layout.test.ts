import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { NotebookStore } from './notebooks.js';
import { checkNotebookLayout, describeLayoutChange, notebookLayoutGuide, cleanLayout, notebookLayoutOf, resolveNotebookLayout, splitNotebookHeader, DEFAULT_NOTEBOOK_LAYOUT, NOTEBOOK_LAYOUT_PRESETS } from './notebook-layout.js';
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
      .toEqual({ ok: false, errors: ['x: "when" must be one of map, funnel, steps, options, decided (or !one).'] });
    expect(checkNotebookLayout([{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Nope' }]).ok).toBe(false);
    expect(checkNotebookLayout('no').ok).toBe(false);
    expect(cleanLayout('shortlist')).toBe(DEFAULT_NOTEBOOK_LAYOUT);
    expect(cleanLayout({ preset: 'shortlist' })).toBe(DEFAULT_NOTEBOOK_LAYOUT);
    expect(cleanLayout('nope')).toBeUndefined();
    expect(cleanLayout({ preset: 'shortlist', components: page })).toEqual({ preset: 'shortlist', components: page });
    expect(notebookLayoutOf({})).toBe(DEFAULT_NOTEBOOK_LAYOUT);
    expect(NOTEBOOK_LAYOUT_PRESETS.map((p) => p.id)).toEqual(['shortlist']);
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
      .toThrow('That layout can\'t be drawn: x: "when" must be one of map, funnel, steps, options, decided (or !one).');
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
