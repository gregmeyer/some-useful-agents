import { describe, it, expect } from 'vitest';
import type { Notebook, NotebookGiven } from '@some-useful-agents/core';
import { givenAdds, givenCard } from './notebooks.js';

const at = '2026-11-22T00:00:00.000Z';
const read = { summary: 'A founder in San Francisco.', facts: [{ label: 'Role', value: 'Founder' }], at };
const nb = (given: NotebookGiven[], tries = 1): Notebook => ({
  id: 'meet-dana', title: 'Prepare for a meeting with Dana', statement: '', status: 'active', given,
  steps: [{ id: 's1', kind: 'profile', title: 'Profile', status: 'done', tries }],
  fields: [], criteria: [], params: [], stages: [], pipeline: [], cadence: '', createdAt: at, updatedAt: at,
} as unknown as Notebook);
const profile: NotebookGiven = { key: 'linkedin', label: 'their LinkedIn profile', state: 'given', text: 'x'.repeat(40), read, at };

describe("what you gave a notebook: what needs you above the title, the rest in the header's add row", () => {
  it('one a step has worked from is a folded "You gave" line in the add row, with what sua read, and no card above the title', () => {
    const n = nb([profile]);
    expect(String(givenCard(n, {}, undefined, 'needs'))).toBe('');
    expect(String(givenCard(n, {}, undefined, 'fresh'))).toBe('');
    const adds = String(givenAdds(n));
    expect(adds).toContain('<div class="nb-hero__adds" role="group" aria-label="Add to this answer">');
    expect(adds).toMatch(/<details class="nb-hero__add" data-nb-act data-nb-act-name="gave"><summary>You gave: their LinkedIn profile<\/summary>/);
    expect(adds).toContain('Their LinkedIn profile, as sua read it:</span> A founder in San Francisco.');
    expect(adds).toContain('<dt>Role</dt><dd>Founder</dd>');
    // Add a file or paste, the same form as before, as a line in the row; one panel open at a time.
    expect(adds).toMatch(/<details class="nb-hero__add" data-nb-given-add data-nb-act data-nb-act-name="add-file">\s*<summary[^>]*>＋ Add a file or paste<\/summary>/);
    expect(adds).toContain('data-given-file="nb-given-new-text"');
    // Several: one line for them.
    expect(String(givenAdds(nb([profile, { ...profile, key: 'resume', label: 'their résumé' }])))).toContain('<summary>You gave 2 things</summary>');
  });

  it('just read, before any step used it: open under the header, so you can check it', () => {
    const n = nb([profile], 0);
    const fresh = String(givenCard(n, {}, undefined, 'fresh'));
    expect(fresh).toContain('nb-given--fresh');
    expect(fresh).toMatch(/<details class="nb-given__item nb-given__item--read" open>/);
    expect(String(givenAdds(n))).not.toContain('You gave');
  });

  it('what needs you stays a card above the title: missing, not matched, being read or not read; one that could help is a line in the row', () => {
    const needs = String(givenCard(nb([
      { key: 'agenda', label: 'the agenda', state: 'missing', at },
      { key: 'notes', label: 'your notes', state: 'skipped', at },
      { ...profile, read: undefined },
    ]), {}, undefined, 'needs'));
    expect(needs).toContain('aria-label="What this answer needs from you"');
    expect(needs).toContain('sua needs the agenda.');
    expect(needs).toContain('Not matched to your notes:');
    expect(needs).toContain("sua hasn't read their LinkedIn profile yet.");
    expect(String(givenCard(nb([profile]), { linkedin: 'working' }, undefined, 'needs'))).toContain('sua is reading their LinkedIn profile');
    const want = nb([{ key: 'cv', label: 'their CV', state: 'missing', optional: true, at }]);
    expect(String(givenCard(want, {}, undefined, 'needs'))).toBe('');
    expect(String(givenAdds(want))).toContain('<summary>If you have their CV</summary>');
  });

  it('an archived notebook has no add row', () => {
    expect(String(givenAdds({ ...nb([profile]), archivedAt: at } as Notebook)).trim()).toBe('');
  });
});
