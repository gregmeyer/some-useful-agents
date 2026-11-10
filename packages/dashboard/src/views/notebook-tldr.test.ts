import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { tldrData, tldrCard, tldrChart, tldrLayoutFor, renderNotebookTldr, TLDR_WIDTH } from './notebook-tldr.js';
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

  it('about someone: their name, role and company with their photo, your goal, then the talking points; a company gets its logo', () => {
    const about = { person: { name: 'Dana Reyes', summary: 'Runs logistics sales at Acme.', facts: [{ key: 'role', label: 'Role', value: 'VP Sales', at }, { key: 'organization', label: 'Company', value: 'Acme Corp', at }] } };
    const meeting = nb({ fields: [], about, meeting: { goal: 'Agree a pilot' }, briefing: { points: [{ text: 'Ask about routing', from: [] }], questions: [], watch: [], at, by: 'agent:notebook-writer' } } as unknown as Partial<Notebook>);
    const t = tldrData(meeting, [], undefined, undefined, { src: 'data:image/png;base64,AAAA' });
    expect(t).toMatchObject({ who: 'person', leadLabel: "Who you're meeting", lead: 'Dana Reyes', leadFacts: ['VP Sales', 'Acme Corp'], note: 'Your goal: Agree a pilot', leadPicture: 'data:image/png;base64,AAAA', points: ['Ask about routing'], pointsLabel: 'Talking points' });
    expect(t.stats).toEqual([{ value: '1', label: 'talking point' }]);
    const card = render(tldrCard(t));
    expect(card).toContain('<p class="tl__name">Dana Reyes</p>');
    expect(card).toContain('<span class="tl__pic is-portrait"><img src="data:image/png;base64,AAAA" alt="Dana Reyes"></span>');
    expect(card).toContain('<p class="tl__note">Your goal: Agree a pilot</p>');

    // No photo kept: the same card without one. No goal: who they are, in a sentence. No talking points yet: what's kept counts as findings.
    const early = tldrData(nb({ fields: [], about } as unknown as Partial<Notebook>), [option('Her talk on routing', {})]);
    expect(early).toMatchObject({ who: 'person', lead: 'Dana Reyes', note: 'Runs logistics sales at Acme.', points: [] });
    expect(early.leadPicture).toBeUndefined();
    expect(early.stats[0]).toEqual({ value: '1', label: 'finding kept' });
    expect(render(tldrCard(early))).not.toContain('tl__pic');

    // A company: its logo shown whole, not cropped like a portrait.
    const co = tldrData(nb({ fields: [], about: { company: { name: 'Acme Corp', facts: [{ key: 'what_they_do', label: 'What they do', value: 'Freight software', at }] } } } as unknown as Partial<Notebook>), [], undefined, undefined, { src: '/x.png', logo: true });
    expect(co).toMatchObject({ who: 'company', leadLabel: 'The company', lead: 'Acme Corp', leadFacts: ['Freight software'], logo: true });
    expect(render(tldrCard(co))).toContain('<span class="tl__pic"><img src="/x.png" alt="Acme Corp"></span>');
  });

  it('redrawn by a spec: its size, tone and layout as classes, its headline over the title, its parts in its order, only what the size holds', () => {
    const many = [...entries.filter((e) => !e.ruledOut), option('Six', { price: 10 }), option('Seven', { price: 20 }), option('Eight', { price: 30 }), option('Nine', { price: 40 })];
    const t = tldrData(nb(), many);
    expect(t.chart!.bars).toHaveLength(8);
    const card = render(tldrCard(t, { spec: { size: 'landscape', tone: 'editorial', layout: 'split', parts: ['bars', 'stats', 'lead'], headline: 'Eight ways to power a cart', takeaway: 'Lead-acid starts cheap.' } }));
    expect(card).toContain('<article class="tl tl--landscape tl--editorial tl--split"');
    // The notebook's title becomes the line over the headline written for it.
    expect(card).toContain('<p class="tl__kicker">Choose batteries for a 2000 EZGO TXT</p><h1 class="tl__title">Eight ways to power a cart</h1><p class="tl__lede">Lead-acid starts cheap.</p>');
    // Landscape holds 5 bars: the rest are counted, and the bars are measured against the longest one shown.
    expect(card.match(/class="tl__bar[ "]/g)).toHaveLength(5);
    expect(card).toContain('and 4 more in the running');
    expect(card).toContain('style="width:100.0%"');
    // Split: the words at the left (stats before the lead, as asked), the bars at the right.
    const [left, right] = card.split('<div class="tl__col">').slice(1);
    expect(left.indexOf('tl__stats')).toBeLessThan(left.indexOf('tl__lead'));
    expect(left).not.toContain('tl__bars');
    expect(right).toContain('tl__bars');

    // Hero: the lead's own number very large, with its name; a part left out isn't drawn.
    const hero = render(tldrCard(t, { spec: { size: 'square', tone: 'bold', layout: 'hero', parts: ['lead', 'bars'] } }));
    expect(hero).toContain('<article class="tl tl--square tl--bold tl--hero"');
    expect(hero).toMatch(/<div class="tl__label">Best lead · Price<\/div><p class="tl__big">\$10<\/p><p class="tl__under">Six<\/p>/);
    expect(hero).not.toContain('tl__stats');
    expect(hero).not.toContain('tl__kicker');
    // A spec with fewer bars than the size holds.
    expect(render(tldrCard(t, { spec: { size: 'portrait', tone: 'plain', layout: 'stack', parts: ['bars'], bars: 3 } })).match(/class="tl__bar[ "]/g)).toHaveLength(3);

    // About someone, as a hero: their portrait and name large; a split keeps the portrait.
    const person = tldrData(nb({ fields: [], about: { person: { name: 'Dana Reyes', facts: [{ key: 'role', label: 'Role', value: 'VP Sales', at }] } }, briefing: { points: [1, 2, 3, 4, 5].map((i) => ({ text: `Point ${String(i)}`, from: [] })), questions: [], watch: [], at, by: 'x' } } as unknown as Partial<Notebook>), [], undefined, undefined, { src: '/p.png' });
    const who = render(tldrCard(person, { spec: { size: 'landscape', tone: 'plain', layout: 'hero', parts: ['lead', 'points'] } }));
    expect(who).toContain('<section class="tl__hero tl__hero--who"><span class="tl__pic is-portrait">');
    expect(who).toContain('<p class="tl__big">Dana Reyes</p><p class="tl__under">VP Sales</p>');
    expect(who.match(/<li>Point/g)).toHaveLength(3); // landscape holds 3 points
    // No spec: the standard picture, with no redraw classes.
    expect(render(tldrCard(t))).toContain('<article class="tl" aria-label');
    // The page is as wide as the spec's size.
    expect(renderNotebookTldr({ nb: nb(), entries, spec: { size: 'landscape', tone: 'plain', layout: 'stack', parts: ['lead'] } })).toContain('body { width: 1200px; }');
  });

  it('picture-led layouts: a cover band, a spotlight side, a lineup of tiles; each falls back when there is no picture to lead with', () => {
    // The battery shortlist with a picture on each of its four priced options: a photo, a logo, a drawing, a photo.
    const base = tldrData(nb(), entries);
    const kinds = ['photo', 'logo', 'drawing', 'photo'] as const;
    const t = { ...base, leadPicture: '/pic/0', leadPictureKind: 'photo' as const, chart: { ...base.chart!, bars: base.chart!.bars.map((b, i) => ({ ...b, picture: `/pic/${String(i)}`, kind: kinds[i] })) } };

    // Lineup: the top options as tiles in rank order, the lead marked, the rest counted; a photo over a blur of itself, a logo whole on white.
    const lineup = render(tldrCard(t, { spec: { size: 'standard', tone: 'plain', layout: 'lineup', parts: ['stats'] } }));
    expect(lineup).toContain('<article class="tl tl--standard tl--plain tl--lineup"');
    expect(lineup.match(/class="tl__tile[ "]/g)).toHaveLength(4);
    expect(lineup).toContain('<li class="tl__tile is-lead"><span class="tl__frame is-photo" style="--pic:url(');
    expect(lineup).toContain('<img src="/pic/0" alt="Werker 220Ah"></span><span class="tl__rank">Best lead</span><span class="tl__tname">Werker 220Ah</span><span class="tl__tval">$139.99</span>');
    expect(lineup).toContain('<span class="tl__rank">#2</span>');
    expect(lineup).toMatch(/class="tl__frame is-(logo|drawing)"><img/);
    // The tiles stand in for the lead and the bars, and show even when "bars" wasn't asked for.
    expect(lineup).not.toContain('tl__bars');
    expect(lineup).not.toContain('class="tl__lead"');
    expect(lineup).toContain('tl__stats');
    // Square and portrait hold three tiles.
    expect(render(tldrCard(t, { spec: { size: 'square', tone: 'plain', layout: 'lineup', parts: ['bars'] } })).match(/class="tl__tile[ "]/g)).toHaveLength(3);

    // Cover: the lead's picture as a band over everything else; the small picture beside the words is left out.
    const cover = render(tldrCard(t, { spec: { size: 'portrait', tone: 'editorial', layout: 'cover', parts: ['lead', 'stats', 'bars'] } }));
    expect(cover).toContain('<article class="tl tl--portrait tl--editorial tl--cover"');
    expect(cover).toMatch(/<div class="tl__art"><span class="tl__frame is-photo"[^>]*><img[^>]*><\/span><\/div>\s*<div class="tl__inner"><header/);
    expect(cover).not.toContain('class="tl__pic');
    // The band takes room: fewer bars than the size otherwise holds.
    expect(cover.match(/class="tl__bar[ "]/g)).toHaveLength(4);

    // What it's really drawn in: decided from the pictures there are.
    const spec = (layout: 'cover' | 'lineup' | 'spotlight', size: 'standard' | 'landscape' | 'square' | 'portrait' = 'standard') => ({ size, tone: 'plain' as const, layout, parts: ['lead' as const] });
    expect(tldrLayoutFor(t, spec('cover', 'landscape'))).toBe('spotlight'); // no room for a band on landscape
    expect(tldrLayoutFor(t, spec('spotlight', 'square'))).toBe('cover'); // no room side by side on a square
    expect(tldrLayoutFor(t, spec('spotlight', 'landscape'))).toBe('spotlight');
    const none = tldrData(nb(), entries); // no pictures at all
    expect(tldrLayoutFor(none, spec('lineup'))).toBe('stack');
    expect(tldrLayoutFor(none, spec('cover'))).toBe('stack');
    expect(tldrLayoutFor(none, spec('spotlight', 'landscape'))).toBe('split');
    expect(render(tldrCard(none, { spec: spec('cover') }))).toContain('tl--stack');
    // Two pictured options aren't a lineup: the lead's picture as a cover instead.
    const two = { ...t, chart: { ...t.chart!, bars: t.chart!.bars.map((b, i) => (i < 2 ? b : { ...b, picture: undefined })) } };
    expect(tldrLayoutFor(two, spec('lineup'))).toBe('cover');

    // A person: a spotlight fills its side with the portrait; a cover's wide band shows it whole; never a lineup.
    const person = tldrData(nb({ fields: [], about: { person: { name: 'Dana Reyes', facts: [] } }, briefing: { points: [{ text: 'Ask about routing', from: [] }], questions: [], watch: [], at, by: 'x' } } as unknown as Partial<Notebook>), [], undefined, undefined, { src: '/p.png' });
    expect(person.leadPictureKind).toBe('portrait');
    const spot = render(tldrCard(person, { spec: { size: 'landscape', tone: 'plain', layout: 'spotlight', parts: ['lead', 'points'] } }));
    expect(spot).toContain('<div class="tl__art"><span class="tl__frame is-portrait" style="--pic:url(');
    expect(spot).toContain('<img src="/p.png" alt="Dana Reyes"></span></div>');
    expect(spot).toContain('<p class="tl__name">Dana Reyes</p>');
    expect(tldrLayoutFor(person, spec('lineup', 'portrait'))).toBe('cover');
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
