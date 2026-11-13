/**
 * Reading a paste into facts: only facts whose quote is in the paste are
 * kept, and a correction keeps what sua read where a line is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { correctedRead, givenReadInputs, parseGivenRead } from './notebook-given-read.js';

const PASTE = 'Jobs  Messaging\nDirector of Partnerships at Riverbend Trust\nJan 2019 – Present · 6 yrs\nLed a team of nine; raised $4.2M in new grants.\nPeople also viewed';
const answer = (v: unknown) => `Here it is.\n<read>\n${JSON.stringify(v)}\n</read>`;

describe('parseGivenRead', () => {
  it('keeps a fact only when its quote is in the paste, whatever the punctuation or line breaks', () => {
    const out = parseGivenRead(answer({ summary: 'A partnerships director.', facts: [
      { label: 'Current role', value: 'Director of Partnerships, Riverbend Trust, since 2019', quote: 'director of partnerships at   riverbend trust' },
      { label: 'Achievement', value: 'Raised $4.2M in grants', quote: 'Led a team of nine; raised $4.2M in new grants', byYou: true },
      { label: 'Location', value: 'Conway, Arkansas', quote: 'Based in Conway, Arkansas' },
      { label: 'Level', value: 'Director', quote: 'Dir' },
      { label: 'No quote', value: 'x' },
    ] }), PASTE, '2026-11-13T00:00:00.000Z');
    if ('error' in out) throw new Error(out.error);
    expect(out.read.facts.map((f) => f.label)).toEqual(['Current role', 'Achievement']);
    // A model can't mark a fact as the person's own.
    expect(out.read.facts[1].byYou).toBeUndefined();
    expect(out.dropped).toBe(3);
    expect(out.read.summary).toBe('A partnerships director.');
  });

  it('says why an answer can\'t be used', () => {
    expect(parseGivenRead(undefined, PASTE)).toEqual({ error: 'It has no <read> JSON object with a summary and facts.' });
    expect(parseGivenRead('<read>{nope</read>', PASTE)).toEqual({ error: 'Its <read> block is not valid JSON.' });
    expect(parseGivenRead(answer({ summary: 'x', facts: [{ label: 'a', value: 'b', quote: 'never said in the paste' }] }), PASTE)).toMatchObject({ error: expect.stringContaining('word for word') });
  });
});

describe('correctedRead', () => {
  it('keeps the quote of a line left as it was, and marks a changed or new line as yours', () => {
    const before = { summary: 'S.', facts: [{ label: 'Current role', value: 'Director', quote: 'Director of Partnerships' }, { label: 'Location', value: 'Conway', quote: 'Conway, Arkansas' }], at: 'x' };
    const out = correctedRead(before, 'Current role: Director\n\nLocation: Little Rock\nWants: remote work: two days a week\nno colon here', '2026-11-13T00:00:00.000Z');
    expect(out).toEqual({ summary: 'S.', at: '2026-11-13T00:00:00.000Z', facts: [
      { label: 'Current role', value: 'Director', quote: 'Director of Partnerships' },
      { label: 'Location', value: 'Little Rock', byYou: true },
      { label: 'Wants', value: 'remote work: two days a week', byYou: true },
    ] });
    // Every line deleted and no summary: nothing is left of the reading.
    expect(correctedRead({ summary: '', facts: before.facts, at: 'x' }, '')).toBeUndefined();
  });
});

describe('givenReadInputs', () => {
  it('gives the reader the label, what the notebook is for, the paste, and the reason on a second try', () => {
    expect(givenReadInputs({ title: 'Jobs', statement: 'Jobs matched to my profile.' }, { label: 'your LinkedIn profile', text: PASTE })).toEqual({ LABEL: 'your LinkedIn profile', FOR: 'Jobs matched to my profile.', TEXT: PASTE, ERRORS: '' });
    expect(givenReadInputs({ title: 'Jobs', statement: '' }, { label: 'x', text: 'y' }, 'bad.').ERRORS).toBe("Your last answer couldn't be used: bad. Answer again, fixing that.");
  });
});
