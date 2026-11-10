import { describe, it, expect } from 'vitest';
import type { Notebook } from '@some-useful-agents/core';
import { cardForAgent, parseTldrAnswer, strayNumbers, tldrRedrawInputs } from './notebook-tldr-redraw.js';
import type { TldrData } from '../views/notebook-tldr.js';

const nb = { title: 'Choose batteries for a 2000 EZGO TXT', statement: 'Good battery options' } as Notebook;
const card: TldrData = {
  title: nb.title, leadLabel: 'Best lead', lead: 'Werker 220Ah', leadFacts: ['Price $139.99', 'Location Phoenix, AZ'], leadPicture: 'data:image/png;base64,AAAA',
  stats: [{ value: '8', label: 'options in the running' }, { value: '$139.99–$2,130.99', label: 'price, lowest to highest' }],
  chart: { label: 'Price', order: 'lowest first', more: 0, max: 2130.99, bars: [{ name: 'Werker 220Ah', value: 139.99, text: '$139.99', lead: true }, { name: 'Eco bundle', value: 2130.99, text: '$2,130.99', lead: false }] },
  points: [],
};
const answer = (o: unknown) => `Here it is.\n<tldr>\n${JSON.stringify(o)}\n</tldr>`;
const at = '2026-11-10T00:00:00.000Z';

describe('redrawing a TL;DR picture from an ask', () => {
  it('gives the agent the picture in words and numbers, the choices, the ask and how it is drawn now', () => {
    expect(cardForAgent(card)).toEqual({
      lead: { label: 'Best lead', text: 'Werker 220Ah', facts: ['Price $139.99', 'Location Phoenix, AZ'], picture: true },
      stats: card.stats,
      bars: { by: 'Price', order: 'lowest first', shown: [{ name: 'Werker 220Ah', value: '$139.99', lead: true }, { name: 'Eco bundle', value: '$2,130.99' }], more: 0 },
    });
    const first = tldrRedrawInputs(nb, card, 'for LinkedIn');
    expect(JSON.parse(first.NOTEBOOK)).toEqual({ title: nb.title, for: 'Good battery options' });
    expect(first.CARD).not.toContain('base64');
    expect(first.OPTIONS).toContain('"landscape": 1200×627.');
    expect(first).toMatchObject({ ASK: 'for LinkedIn', CURRENT: '', ERRORS: '' });
    const again = tldrRedrawInputs({ ...nb, tldr: { size: 'landscape', tone: 'plain', layout: 'stack', parts: ['lead'], headline: 'H', about: 'not sent', ask: 'x' } } as Notebook, card, 'more editorial', '"neon" is not a tone.');
    expect(JSON.parse(again.CURRENT)).toEqual({ size: 'landscape', tone: 'plain', layout: 'stack', parts: ['lead'], headline: 'H' });
    expect(again.ERRORS).toBe('Your last answer couldn\'t be used: "neon" is not a tone. Answer again, fixing that and keeping the rest.');
  });

  it('keeps an answer chosen from the choices, with the ask and when', () => {
    const out = parseTldrAnswer(answer({ size: 'landscape', tone: 'editorial', layout: 'split', parts: ['lead', 'bars'], headline: 'Lead-acid sets start at $139.99', takeaway: 'Lithium bundles run past $2,130.99.', about: 'Wide for LinkedIn.' }), nb, card, 'for LinkedIn', at);
    expect(out).toEqual({ spec: { size: 'landscape', tone: 'editorial', layout: 'split', parts: ['lead', 'bars'], headline: 'Lead-acid sets start at $139.99', takeaway: 'Lithium bundles run past $2,130.99.', about: 'Wide for LinkedIn.', ask: 'for LinkedIn', at } });
  });

  it("can't be used: no JSON, or a size, tone or layout that isn't one of the choices (named, so a second try can fix it)", () => {
    expect(parseTldrAnswer(undefined, nb, card, 'x')).toEqual({ error: 'It has no <tldr> JSON object.' });
    expect(parseTldrAnswer('<tldr>{not json</tldr>', nb, card, 'x')).toEqual({ error: 'Its <tldr> block is not valid JSON.' });
    expect(parseTldrAnswer(answer(['landscape']), nb, card, 'x')).toEqual({ error: 'It has no <tldr> JSON object.' });
    expect(parseTldrAnswer(answer({ size: 'banner', tone: 'neon', layout: 'stack' }), nb, card, 'x')).toEqual({
      error: '"banner" is not a size (use one of: standard, landscape, square, portrait). "neon" is not a tone (use one of: plain, editorial, bold).',
    });
  });

  it('a number in the written words has to be in the picture\'s data, as it is there; else the words can be left out', () => {
    expect(strayNumbers(['Eight ways, from $139.99', 'Past $2,130.99 for 2000 EZGO carts'], nb, card)).toEqual([]);
    expect(strayNumbers(['From $140', 'Save 40% in 2026'], nb, card)).toEqual(['140', '40', '2026']);
    const out = parseTldrAnswer(answer({ size: 'square', tone: 'bold', layout: 'hero', headline: 'Batteries from $140', takeaway: 'Eight options.' }), nb, card, 'bolder', at);
    expect(out).toMatchObject({ error: "The headline or takeaway has a number that CARD doesn't (140). Use only numbers that are in CARD, written as they are there, or none." });
    // What would be kept if a second try doesn't fix it: the drawing, without the words.
    expect((out as { spec: unknown }).spec).toEqual({ size: 'square', tone: 'bold', layout: 'hero', parts: ['lead', 'stats', 'bars', 'points'], ask: 'bolder', at });
  });
});
