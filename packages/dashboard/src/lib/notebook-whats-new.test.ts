import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookEntry } from '@some-useful-agents/core';
import { whatsNew, whatsNewLines } from './notebook-whats-new.js';

// Two profile runs (Oct 26, Oct 28), two finds, two writes: each part against its own run before.
const D = (d: number, h = 10) => `2026-10-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00.000Z`;
const steps = [
  { id: 's1', title: 'Learn about Dana Reyes', kind: 'profile' },
  { id: 's2', title: 'Find 5 themes', kind: 'find', target: 5 },
  { id: 's3', title: 'Write the talking points', kind: 'write' },
];
const pass = (stepId: string, d: number) => ({ stepId, startedAt: D(d), finishedAt: D(d, 11) });
const passes = [pass('s1', 26), pass('s2', 26), pass('s3', 26), pass('s1', 28), pass('s2', 28), pass('s3', 28)];
const fact = (key: string, label: string, value: string, extra: Record<string, unknown> = {}) => ({ key, label, value, at: D(28, 10), ...extra });
const nb = (over: Partial<Notebook> = {}) => ({
  id: 'n', title: 'Prepare for a meeting with Dana Reyes', steps,
  about: {
    person: {
      name: 'Dana Reyes', updatedAt: D(28, 10),
      facts: [
        fact('role', 'Role', 'COO', { firstAt: D(26, 10), changedAt: D(28, 10), was: { value: 'VP Ops', at: D(26, 10) } }),
        fact('location', 'Based in', 'Austin', { firstAt: D(26, 10) }),
        fact('revenue', 'Revenue', '$4M', { firstAt: D(28, 10) }),
        // Learned before this was kept: never new.
        fact('school', 'School', 'UT Austin'),
        // You settled it after the run: not the run's news.
        fact('organization', 'Company', 'Acme', { firstAt: D(26, 10), changedAt: D(28, 15), was: { value: 'Globex', at: D(26, 10) } }),
      ],
      affiliations: [{ name: 'Freight Founders', firstAt: D(28, 10) }, { name: 'Initech' }],
    },
    company: { name: 'Acme', updatedAt: D(28, 10), facts: [], competitors: [{ name: 'Karbon', firstAt: D(28, 10) }, { name: 'Xero', firstAt: D(26, 10) }] },
  },
  briefing: { points: [{ text: 'Ask about hiring', from: [] }, { text: 'Their new office', from: [] }], questions: [], watch: [], at: D(28, 10), by: 'notebook-writer', previous: { at: D(26, 10), items: ['Ask about hiring', 'Their podcast', 'Board seat'] } },
  ...over,
}) as unknown as Notebook;
const option = (createdAt: string) => ({ kind: 'option', createdAt }) as unknown as NotebookEntry;

describe("what's new since the last run", () => {
  it('compares each part with its own run before: facts, lists, what was found, what was rewritten', () => {
    const w = whatsNew(nb(), [option(D(26, 10)), option(D(28, 10)), option(D(28, 10))], passes)!;
    expect(w).toMatchObject({
      since: D(26, 11), at: D(28, 11), empty: false,
      facts: { new: ['Revenue'], changed: [{ label: 'Role', was: 'VP Ops', now: 'COO' }] },
      competitors: ['Karbon'], affiliations: ['Freight Founders'], sources: 2, points: { new: 1, dropped: 2 },
    });
    expect(w.marks).toEqual({ 'person:role': { mark: 'changed', was: 'VP Ops' }, 'person:revenue': { mark: 'new' } });
    expect(whatsNewLines(w)).toEqual([
      '1 new fact: Revenue', 'Changed: Role, VP Ops → COO', '1 new competitor: Karbon', '1 new other company: Freight Founders',
      '2 new findings from the search', 'Rewritten: 1 new, 2 dropped',
    ]);
  });

  it('says nothing changed after a recheck, and nothing at all after a first run', () => {
    const quiet = nb({ about: { person: { name: 'Dana Reyes', updatedAt: D(28), facts: [fact('location', 'Based in', 'Austin', { firstAt: D(26, 10) })] } } as never, briefing: undefined });
    const w = whatsNew(quiet, [option(D(26, 10))], passes)!;
    expect(w.empty).toBe(true);
    expect(whatsNewLines(w)).toEqual([]);
    expect(whatsNew(nb(), [], [pass('s1', 26), pass('s2', 26), pass('s3', 26)])).toBeUndefined();
    // A run still going doesn't count.
    expect(whatsNew(nb(), [], [pass('s1', 26), { stepId: 's1', startedAt: D(28) }])).toBeUndefined();
  });
});
