import { describe, it, expect } from 'vitest';
import { answerArtKind, answerCover, answerDiagramView } from './answer-art.js';

describe('answer art', () => {
  it('lays a ladder out on a month axis, each rung where it starts and ends', () => {
    const v = answerDiagramView({ type: 'ladder', rungs: [12, 24, 36, 48, 60].map((m) => ({ label: `${String(m)}-month CD`, start: 0, end: m, amount: 5000 })) });
    if (v.type !== 'ladder') throw new Error(v.type);
    expect(v.rungs.map((r) => [r.left, r.width])).toEqual([[0, 20], [0, 40], [0, 60], [0, 80], [0, 100]]);
    expect(v.rungs[0].note).toBe('$5,000 · due 1 yr');
    expect(v.axis.map((t) => t.label)).toEqual(['Now', '1 yr', '2 yr', '3 yr', '4 yr', '5 yr']);
    expect(v.lines[4]).toBe('60-month CD: months 0–60, $5,000');
    expect(JSON.stringify(v)).not.toMatch(/NaN|Infinity/);
  });

  it('splits an amount by share, and lists a flow in order', () => {
    const s = answerDiagramView({ type: 'split', parts: [{ label: 'Keep handy', amount: 5000 }, { label: 'Ladder', amount: 20000 }] });
    expect(s).toMatchObject({ type: 'split', total: '$25,000', parts: [{ width: 20, amount: '$5,000' }, { width: 80, amount: '$20,000' }] });
    expect(answerDiagramView({ type: 'flow', nodes: [{ label: 'Decide what you may need' }, { label: 'Split the rest' }] }).lines).toEqual(['1. Decide what you may need', '2. Split the rest']);
  });

  it('draws a cover for what the question is about, as an image with nothing that runs', () => {
    expect(answerArtKind({ title: 'Research CD ladders for $25,000', statement: '' })).toBe('money');
    expect(answerArtKind({ title: '4 days in Lisbon', statement: 'A trip in March' })).toBe('travel');
    expect(answerArtKind({ title: 'Which mixer?', statement: '' })).toBe('thing');
    const { src } = answerCover({ title: 'CD ladders', statement: '' });
    expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(src.split(',')[1], 'base64').toString('utf8');
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(svg).not.toMatch(/<script|href=|url\(|gradient/i);
  });
});
