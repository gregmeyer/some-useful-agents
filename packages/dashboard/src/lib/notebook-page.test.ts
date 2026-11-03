import { describe, it, expect } from 'vitest';
import { parsePageAnswer, notebookForPage, written } from './notebook-page.js';
import type { Notebook } from '@some-useful-agents/core';

const page = (v: unknown) => `Here it is.\n<page>\n${JSON.stringify(v)}\n</page>`;
const BRIEFING = [
  { id: 'root', component: 'Column', children: ['agenda_panel', 'said_panel'] },
  { id: 'agenda_panel', component: 'Panel', title: 'What to talk about', child: 'agenda' },
  { id: 'agenda', component: 'Agenda', points: { path: '/notebook/talkingPoints' }, questions: { path: '/notebook/questions' } },
  { id: 'said_panel', component: 'Panel', title: 'What they care about', child: 'said' },
  { id: 'said', component: 'QuoteList', items: { path: '/notebook/quotes' } },
];

describe('a notebook deciding its page', () => {
  it('keeps the shortlist, takes a page that checks out, and says why one doesn\'t', () => {
    expect(parsePageAnswer(page({ preset: 'shortlist', about: 'choosing among many' }))).toEqual({ keep: true, about: 'choosing among many' });
    expect(parsePageAnswer(page({ about: 'a briefing: what to talk about, what they said', components: BRIEFING })))
      .toEqual({ layout: { components: BRIEFING, about: 'a briefing: what to talk about, what they said' } });
    expect(parsePageAnswer(page({ preset: 'brochure' }))).toEqual({ error: expect.stringContaining('There\'s no ready-made page "brochure"') });
    expect(parsePageAnswer(page({ components: [{ id: 'root', component: 'Column', children: ['x'] }, { id: 'x', component: 'Nope' }] }))).toEqual({ error: expect.any(String) });
    expect(parsePageAnswer(page({ components: [{ id: 'root', component: 'Column', children: [], when: 'sunny' }] }))).toEqual({ error: expect.stringContaining('"when" must be one of') });
    expect(parsePageAnswer('no block')).toEqual({ error: 'There was no <page> block.' });
    expect(parsePageAnswer(undefined)).toEqual({ error: 'There was no <page> block.' });
  });

  it('tells the agent the notebook\'s goal and shape, not its options', () => {
    const nb = {
      id: 'm', title: 'Prepare for a meeting with Dana Reyes', statement: 'What matters to Dana', params: ['30 minutes'], criteria: [{ text: 'Talking points chosen', met: false }],
      fields: [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'evidence', label: 'Evidence', type: 'text', role: 'quote' }],
      steps: [{ id: 's1', title: 'Find 5 themes', kind: 'find', target: 5, status: 'todo', tries: 0 }],
      checks: [], stages: [], pipeline: [], cadence: '', status: 'active', createdAt: '', updatedAt: '',
    } as unknown as Notebook;
    expect(notebookForPage(nb)).toEqual({
      title: 'Prepare for a meeting with Dana Reyes', for: 'What matters to Dana', limits: ['30 minutes'], doneWhen: ['Talking points chosen'],
      facts: [{ key: 'theme', label: 'Theme', type: 'text' }, { key: 'evidence', label: 'Evidence', type: 'text', role: 'quote' }],
      steps: [{ title: 'Find 5 themes', kind: 'find', target: 5 }],
    });
  });
});

describe('what was written, as the page agent sees it', () => {
  it('is the shape of the parts (keys, kinds, sizes, what they deliver), never their words; nothing before a write', () => {
    expect(written({})).toBeUndefined();
    expect(written({ answer: { question: 'q', text: '', confidence: 'low', findings: [], open: [], at: '', by: '' } })).toBeUndefined();
    const w = written({
      answer: {
        question: 'q', text: 'Split it into **five CDs**.', confidence: 'medium', findings: [{ text: 'f', from: [] }], open: ['o1', 'o2'], at: '', by: '',
        sections: [
          { kind: 'table', title: 'A simple rubric', delivers: 'A rubric written', columns: ['If', 'Then'], rows: [{ cells: ['a', 'b'], from: [] }] },
          { kind: 'diagram', title: 'One way to ladder $25,000', diagram: { type: 'ladder', rungs: [{ label: 'a', start: 0, end: 12 }, { label: 'b', start: 0, end: 24 }] } },
          { kind: 'steps', title: 'How a ladder works', items: [{ text: 's1', from: [] }, { text: 's2', from: [] }, { text: 's3', from: [] }] },
          { kind: 'text', title: 'Why', body: 'one two three' },
        ],
      },
    });
    expect(w).toEqual({
      kind: 'answer', confidence: 'medium', findings: 1, open: 2,
      parts: [
        { key: 'a-simple-rubric', title: 'A simple rubric', kind: 'table', rows: 1, columns: ['If', 'Then'], delivers: 'A rubric written' },
        { key: 'one-way-to-ladder-25-000', title: 'One way to ladder $25,000', kind: 'diagram', diagram: 'ladder', parts: 2 },
        { key: 'how-a-ladder-works', title: 'How a ladder works', kind: 'steps', steps: 3 },
        { key: 'why', title: 'Why', kind: 'text', words: 3 },
      ],
    });
    expect(JSON.stringify(w)).not.toContain('five CDs');
    expect(written({ plan: { summary: 's', items: [{ when: 'Day 1', title: 't', from: [] }, { when: 'Day 2', title: 't', from: [] }], before: ['b'], open: [], at: '', by: '' } }))
      .toEqual({ kind: 'plan', days: 2, before: 1, open: 0, parts: [] });
  });
});
