import { describe, it, expect } from 'vitest';
import type { Notebook } from '@some-useful-agents/core';
import { editStarters } from './notebook-edit-starters.js';

const at = '2026-11-10T00:00:00.000Z';
const nb = (over: Partial<Notebook> = {}): Notebook => ({
  id: 'nb', title: 'Choose batteries', statement: 'Good battery options', params: [], pipeline: [], stages: [], checks: ['Fits a 2000 EZGO TXT'], cadence: '', status: 'active',
  criteria: [{ text: 'At least five battery options found', met: true }, { text: 'A decision recorded', met: false }],
  fields: [{ key: 'price', label: 'Price', type: 'money', role: 'price' }, { key: 'capacity', label: 'Capacity', type: 'number', role: 'measure' }, { key: 'seller', label: 'Seller', type: 'text' }],
  steps: [{ id: 's1', title: 'Find 5', kind: 'find', status: 'done', tries: 0 }, { id: 's2', title: 'Check fit', kind: 'check', status: 'todo', tries: 0 }, { id: 's3', title: 'Choose', kind: 'decide', status: 'todo', tries: 0 }],
  createdAt: at, updatedAt: at, ...over,
} as Notebook);
const labels = (s: ReturnType<typeof editStarters>, i: number) => s[i].options.map((o) => o.label);

describe('the Edit page\'s starters say what can finish them, for this notebook', () => {
  it('a shortlist with a price and a measure: the parts its page can lead with, steps it lacks, facts it doesn\'t note, done-whens it doesn\'t have', () => {
    const s = editStarters(nb(), true);
    expect(s.map((x) => x.label)).toEqual(['Add a step to…', 'Make the page lead with…', "Also note each one's…", "It's done when…"]);
    expect(s[1].ask).toBe('This page can lead with');
    expect(labels(s, 1)).toEqual(['the best option', 'the top three, head to head', 'bars by price', 'price against capacity', 'the shortlist', 'how far along it is', 'the funnel']);
    // Each is a whole sentence to send.
    expect(s[1].options[0].text).toBe('Make the page lead with the best option by price, as one large number');
    expect(s[1].options[3].text).toBe('Make the page lead with the map of price against capacity');
    // Steps: not the kinds it has (a decide step), nor a profile step for a shopping notebook.
    expect(labels(s, 0)).toEqual(['find more options', 'look up missing facts', 'check each one', 'narrow to the top 5', 'write up what it found']);
    expect(s[0].options[2].text).toBe('Add a step to check each one against the checks');
    // Facts it doesn't note yet (it has price and seller).
    expect(labels(s, 2)).toEqual(['rating', 'reviews', 'warranty', 'availability', 'shipping cost', 'return policy']);
    // Done-whens it doesn't already have one like (it has "found" and "decision").
    expect(labels(s, 3)).toEqual(['the top 3 are checked', 'it is written up', 'by a date']);
  });

  it('nothing found yet, no numbers: only what there is to lead with', () => {
    const s = editStarters(nb({ fields: [], criteria: [], steps: [] }), false);
    expect(labels(s, 1)).toEqual([]);
    expect(labels(s, 0)).toEqual(['find more options', 'check each one', 'narrow to the top 5', 'write up what it found', 'decide']);
  });

  it('a meeting about someone, written: the talking points and who they are lead; what was kept is what they said', () => {
    const meeting = nb({
      fields: [{ key: 'topic', label: 'Topic', type: 'text' }], criteria: [],
      about: { person: { name: 'Dana Reyes', facts: [] } },
      briefing: { points: [{ text: 'Ask about routing', from: [] }], questions: [], watch: [], at, by: 'x' },
      steps: [{ id: 's1', title: 'Learn', kind: 'profile', status: 'done', tries: 0 }, { id: 's2', title: 'Write', kind: 'write', status: 'done', tries: 0 }],
    } as unknown as Partial<Notebook>);
    const s = editStarters(meeting, true);
    expect(labels(s, 1)).toEqual(['the talking points', 'who they are', 'what they said']);
    expect(labels(s, 0)).not.toContain('write up what it found');
    expect(labels(s, 0)).not.toContain('learn who it is about');
    // An answer or a decision leads when there is one.
    expect(labels(editStarters(nb({ status: 'decided', decision: 'Chose X', answer: { text: 'Buy X.' } } as unknown as Partial<Notebook>), true), 1).slice(0, 2)).toEqual(['the answer', 'the decision']);
  });
});
