import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { tldrData, tldrCard, tldrChart, renderNotebookTldr, TLDR_WIDTH } from './notebook-tldr.js';
import { render } from './html.js';

const at = '2026-11-10T00:00:00.000Z';
const nb = (over: Partial<Notebook> = {}): Notebook => ({
  id: 'nb', title: 'Choose batteries for a 2000 EZGO TXT', statement: 'Good battery options', params: [], criteria: [], pipeline: [], stages: [], checks: [], cadence: '', status: 'active',
  fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'capacity', label: 'Capacity', type: 'number', unit: 'Ah', role: 'measure', better: 'higher' }, { key: 'location', label: 'Location', type: 'text', role: 'place' }],
  createdAt: at, updatedAt: at, ...over,
} as Notebook);
let n = 0;
const option = (title: string, data: Record<string, unknown>, over: Partial<NotebookEntry> = {}): NotebookEntry => ({ id: `e${String(++n)}`, notebookId: 'nb', kind: 'option', title, body: '', by: 'agent:x', data, createdAt: at, ...over } as NotebookEntry);

describe("a notebook's TL;DR picture", () => {
  const entries = [
    option('Duracell Ultra 215Ah', { price: 149.99, capacity: 215, location: 'Mason City, IA' }),
    option('Werker 220Ah', { price: 139.99, capacity: 220, location: 'Phoenix, AZ' }),
    option('Trojan T-105 six-pack', { price: 1574.99, capacity: 225, location: 'Mesa, Arizona' }),
    option('Eco Battery bundle', { price: 2130.99, capacity: 105, location: 'Mesa, Arizona' }),
    option('No price given', { capacity: 100, location: 'Mesa, Arizona' }),
    option('Ruled out one', { price: 99 }, { ruledOut: { reason: 'Wrong voltage', at, by: 'you' } } as Partial<NotebookEntry>),
  ];

  it('a shortlist: the best lead with the fact that ranks it, three numbers, and the options as bars, best first', () => {
    const t = tldrData(nb(), entries);
    expect(t).toMatchObject({ leadLabel: 'Best lead', lead: 'Werker 220Ah' });
    expect(t.leadFacts[0]).toBe('Price $139.99');
    expect(t.stats).toEqual([
      { value: '5', label: 'options in the running' },
      { value: '$139.99–$2,130.99', label: 'price, lowest to highest' },
      { value: '3 of 5', label: 'in Mesa, Arizona' },
    ]);
    // Only the ones with a price are bars, lowest first; the lead is marked; the rest is counted.
    expect(t.chart).toMatchObject({ label: 'Price', order: 'lowest first', more: 1, max: 2130.99 });
    expect(t.chart!.bars.map((b) => `${b.name}:${b.text}:${String(b.lead)}`)).toEqual(['Werker 220Ah:$139.99:true', 'Duracell Ultra 215Ah:$149.99:false', 'Trojan T-105 six-pack:$1,574.99:false', 'Eco Battery bundle:$2,130.99:false']);

    const card = render(tldrCard(t, { now: new Date('2026-11-10T12:00:00Z') }));
    expect(card).toContain('<div class="tl__eyebrow">TL;DR · November 10, 2026</div>');
    expect(card).toContain('<li class="tl__bar is-lead"><span>Werker 220Ah</span>');
    // A bar's length is its share of the longest.
    expect(card).toContain('style="width:100.0%"');
    expect(card).toContain('style="width:6.6%"');
    expect(card).toContain('and 1 more in the running');
    // For the brief: the bars alone. Its lead and numbers are the brief's own words, so they aren't said twice.
    const bars = render(tldrChart(t));
    expect(bars).toContain('<figure class="tl tl--chart"');
    expect(bars).toContain('<figcaption class="tl__label">Price, lowest first</figcaption>');
    expect(bars).toContain('<li class="tl__bar is-lead"><span>Werker 220Ah</span>');
    expect(bars).toContain('and 1 more in the running');
    for (const gone of ['tl__title', 'tl__lead', 'tl__stats', 'Best lead', 'Made with sua']) expect(bars).not.toContain(gone);
    expect(render(tldrChart(tldrData(nb({ fields: [] }), [])))).toBe('');
  });

  it('ranked by fit: the score as a plain number, highest first; decided: the chosen marked', () => {
    const scored = nb({ fields: [{ key: 'fit', label: 'Fit', type: 'number', role: 'score', unit: '0-100' }, { key: 'price', label: 'Price', type: 'money', role: 'price' }] } as Partial<Notebook>);
    const es = [option('Role A', { fit: 80, price: 10 }), option('Role B', { fit: 99, price: 20 }), option('Role C', { fit: 91 }, { chosenAt: at } as Partial<NotebookEntry>)];
    const t = tldrData(scored, es);
    expect(t.chart).toMatchObject({ label: 'Fit', order: 'highest first' });
    expect(t.chart!.bars.map((b) => `${b.name}:${b.text}`)).toEqual(['Role B:99', 'Role C:91', 'Role A:80']);
    expect(t.stats[1]).toEqual({ value: '80–99', label: 'fit, lowest to highest' });
    expect(t.leadFacts[0]).toBe('Fit 99');

    const done = tldrData({ ...scored, status: 'decided', decision: 'Chose Role C.' }, es);
    expect(done).toMatchObject({ leadLabel: 'Chosen', lead: 'Role C' });
    expect(done.stats[0]).toEqual({ value: '1 of 3', label: 'chosen' });
    expect(done.chart!.order).toBe('chosen first');
    expect(done.chart!.bars.map((b) => `${b.name}:${String(b.lead)}`)).toEqual(['Role C:true', 'Role B:false', 'Role A:false']);
  });

  it('too few state what ranks them: plotted by the main measure instead, in that order, its best the lead', () => {
    const es = [option('CD one', { capacity: 3.9 }), option('CD two', { capacity: 4.8 }), option('CD three', { capacity: 4.5, price: 1000 })];
    const t = tldrData(nb(), es);
    expect(t.chart).toMatchObject({ label: 'Capacity', order: 'highest first' });
    expect(t.chart!.bars.map((b) => b.name)).toEqual(['CD two', 'CD three', 'CD one']);
    expect(t.lead).toBe('CD two');
  });

  it('nothing to plot: where it stands in a sentence; an answer leads in its own words; a briefing gives its talking points', () => {
    const empty = tldrData(nb({ fields: [] }), []);
    expect(empty.chart).toBeUndefined();
    expect(empty.leadLabel).toBe('Where it stands');
    expect(render(tldrCard(empty))).not.toContain('tl__bars');

    const answered = tldrData(nb({ answer: { question: 'Which?', text: 'Buy the **Werker** set.', confidence: 'medium', findings: [], open: [], at, by: 'agent:notebook-writer' } } as Partial<Notebook>), entries);
    expect(answered.lead).toBe('Buy the Werker set.');
    expect(answered.sentence).toBe(true);
    expect(answered.chart!.bars).toHaveLength(4);

    const briefed = tldrData(nb({ fields: [], statement: 'Prepare for my meeting with Dana Reyes', briefing: { points: [{ text: 'Ask about routing', from: [] }, { text: 'Raise the pilot', from: [] }], questions: ['What changed?'], watch: [], at, by: 'agent:notebook-writer' } } as Partial<Notebook>), []);
    expect(briefed).toMatchObject({ leadLabel: "What it's for", lead: 'Prepare for my meeting with Dana Reyes', points: ['Ask about routing', 'Raise the pilot'], pointsLabel: 'Talking points' });
    expect(briefed.stats).toEqual([{ value: '2', label: 'talking points' }, { value: '1', label: 'question to ask' }]);
    expect(render(tldrCard(briefed))).toContain('<div class="tl__label">Talking points</div>');
  });

  it('is one self-contained page at the picture\'s width, with no scripts', () => {
    const page = renderNotebookTldr({ nb: nb(), entries, now: new Date('2026-11-10T12:00:00Z') });
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain(`body { width: ${String(TLDR_WIDTH)}px; }`);
    expect(page).toContain('data-theme="light"');
    expect(page).toContain('<article class="tl"');
    expect(page).not.toMatch(/<script/);
    expect(page).not.toContain('href="/');
  });
});
