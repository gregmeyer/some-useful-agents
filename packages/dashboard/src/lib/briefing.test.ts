import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import express from 'express';
import { assetsRouter } from '../routes/assets.js';

// A browser module (assets/briefing.js); a computed path keeps tsc from typing it.
const here = dirname(fileURLToPath(import.meta.url));
type It = Record<string, unknown>;
const { groupBy, matchQuote, monogram, sourceName, textItems, agendaText, planText } = await import(join(here, '..', 'assets', 'briefing.js')) as {
  groupBy: (items: It[], key?: string) => Array<{ group: string; items: It[] }>;
  matchQuote: (it: It, q: string) => boolean;
  monogram: (name: string) => string;
  sourceName: (url: string) => string;
  textItems: (list: unknown) => Array<It & { text: string }>;
  planText: (a: Record<string, unknown>) => string;
  agendaText: (a: { title?: string; points?: unknown; questions?: unknown; watch?: unknown; pointsLabel?: string; questionsLabel?: string; watchLabel?: string }) => string;
};

describe('briefing components', () => {
  it('groups in the order groups first appear, the ungrouped last', () => {
    const g = groupBy([{ q: 1, group: 'B' }, { q: 2 }, { q: 3, group: 'A' }, { q: 4, group: 'B' }]);
    expect(g.map((x) => [x.group, x.items.map((i) => i.q)])).toEqual([['B', [1, 4]], ['A', [3]], ['', [2]]]);
  });

  it('searches every word across a quote\'s text, question, group and source', () => {
    const it0 = { title: 'Human work', quote: 'She writes first drafts herself', ask: 'What do you never hand to AI?', group: 'Craft', sourceText: 'linkedin.com' };
    expect(matchQuote(it0, '')).toBe(true);
    expect(matchQuote(it0, 'drafts AI')).toBe(true);
    expect(matchQuote(it0, 'CRAFT linkedin')).toBe(true);
    expect(matchQuote(it0, 'drafts podcast')).toBe(false);
  });

  it('names a source by its site, and a nameless picture by initials', () => {
    expect(sourceName('https://www.linkedin.com/posts/x')).toBe('linkedin.com');
    expect(sourceName('/notebooks/a/entries/b')).toBe('b');
    expect(sourceName('not a url')).toBe('');
    expect(monogram('Dana Reyes')).toBe('DR');
    expect(monogram('acme, inc.')).toBe('AI');
    expect(monogram('')).toBe('');
  });

  it('copies the agenda as plain text', () => {
    expect(textItems(['a', { text: 'b' }, { label: 'c' }, '', 3])).toEqual([{ text: 'a' }, { text: 'b' }, { label: 'c', text: 'c' }]);
    expect(agendaText({ title: 'Meeting with Dana', points: [{ text: 'Human work', note: 'What do you never hand to AI?' }, 'Signals'], questions: ['How small is too small?'], watch: [{ text: 'Don\'t pitch' }] })).toBe([
      'Meeting with Dana', '',
      'Talking points', '1. Human work', '   What do you never hand to AI?', '2. Signals', '',
      'Questions to ask', '- How small is too small?', '',
      'Watch out for', "- Don't pitch",
    ].join('\n'));
    expect(agendaText({})).toBe('');
    // A plan copies day by day, then what to do first and what's open.
    expect(planText({ title: 'Lisbon', days: [{ when: 'Day 1', items: [{ text: 'Castle', note: 'Go early' }, 'Fado'] }, { when: 'Day 2', items: [] }], before: ['Book fado'], open: ['Which palace?'] })).toBe([
      'Lisbon', '', 'Day 1', '- Castle', '  Go early', '- Fado', '', 'Before you start', '- Book fado', '', 'Still open', '- Which palace?',
    ].join('\n'));
    // An answer's findings copy under their own headings.
    expect(agendaText({ pointsLabel: 'Key findings', points: ['Prices rose 4%'], questionsLabel: 'Still open', questions: ['Does it hold in 2027?'] })).toBe([
      'Key findings', '1. Prices rose 4%', '', 'Still open', '- Does it hold in 2027?', '',
    ].join('\n').replace(/\n$/, ''));
  });

  it('is served for a2ui-sua.js to import', async () => {
    const res = await request(express().use(assetsRouter)).get('/assets/briefing.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.text).toContain('export function agendaText');
  });
});
