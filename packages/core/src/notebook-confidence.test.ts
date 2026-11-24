import { describe, expect, it } from 'vitest';
import { answerCitedIds, answerConfidence, answerNewSources, findingStatus } from './notebook-confidence.js';
import { cleanAnswer, criterionMet, type Notebook, type NotebookAnswer, type NotebookEntry } from './notebooks.js';

const at = '2026-11-19T00:00:00.000Z';
let n = 0;
const page = (url: string, trace?: 'found' | 'missing' | 'unread' | 'no-quote', origin?: NotebookEntry['origin']): NotebookEntry =>
  ({ id: `e${String(++n)}`, notebookId: 'nb', kind: 'evidence', title: url, body: '', by: 'x', fingerprint: url, createdAt: at, ...(trace ? { trace: { status: trace, at } } : {}), ...(origin ? { origin } : {}) } as NotebookEntry);
const nb = (answer: Partial<NotebookAnswer>, check = true): Notebook => ({
  id: 'nb', title: 'Understand A2UI vs CopilotKit', statement: '', params: [], criteria: [], pipeline: [], stages: [], checks: [], cadence: '', status: 'active', fields: [],
  steps: [{ id: 'f', title: 'Find', kind: 'find', status: 'done', tries: 0 }, ...(check ? [{ id: 'c', title: 'Check', kind: 'check' as const, status: 'done' as const, tries: 0 }] : []), { id: 'w', title: 'Write', kind: 'write', shape: 'answer', status: 'done', tries: 0 }],
  answer: { question: 'q', text: 'An answer.', confidence: 'high', findings: [], open: [], at, by: 'x', ...answer },
  createdAt: at, updatedAt: at,
} as Notebook);

describe("how sure an answer is, from its evidence (ADR-0083)", () => {
  const own = page('https://a2ui.org/spec', 'found');
  const own2 = page('https://docs.copilotkit.ai/a', 'found');
  const tns = page('https://thenewstack.io/x', 'found');
  const infoq = page('https://infoq.com/y', 'found');

  it('keeps "high" with two outside publishers, a finding traced to a primary page, nothing missing', () => {
    const es = [own, tns, infoq];
    expect(answerConfidence(nb({ findings: [{ text: 'A', from: [own.id] }, { text: 'B', from: [tns.id, infoq.id] }] }), es)).toEqual({ said: 'high', shown: 'high', why: [] });
  });

  it("caps it at medium when the subjects only speak for themselves, or nothing's been traced", () => {
    expect(answerConfidence(nb({ findings: [{ text: 'A', from: [own.id, own2.id] }] }), [own, own2]))
      .toEqual({ said: 'high', shown: 'medium', why: ['every source it cites is published by A2UI or CopilotKit themselves'] });
    const fresh = [page('https://a2ui.org/x'), page('https://thenewstack.io/u'), page('https://infoq.com/u')];
    expect(answerConfidence(nb({ findings: [{ text: 'A', from: fresh.map((e) => e.id) }] }), fresh)!.why).toEqual(["its sources haven't been traced to their pages yet"]);
    // No check step: nothing to wait for.
    const z = page('https://thenewstack.io/z');
    expect(answerConfidence(nb({ findings: [{ text: 'A', from: [z.id] }] }, false), [z])!.why).toEqual(['only one publisher it cites is from outside A2UI, CopilotKit']);
  });

  it('caps it at low when most findings’ quotes weren’t found, at medium when one was or the sources disagree; an interpretation isn’t traced', () => {
    const miss = page('https://thenewstack.io/m', 'missing');
    const miss2 = page('https://infoq.com/m', 'missing');
    const es = [own, tns, infoq, miss, miss2];
    const low = answerConfidence(nb({ findings: [{ text: 'A', from: [own.id] }, { text: 'B', from: [miss.id] }, { text: 'C', from: [miss2.id] }] }), es)!;
    expect(low).toMatchObject({ shown: 'low' });
    expect(low.why).toContain("2 of 3 findings' quotes weren't found on their pages");
    const one = answerConfidence(nb({ findings: [{ text: 'A', from: [own.id, tns.id, infoq.id] }, { text: 'B', from: [miss.id] }, { text: 'So C', from: [miss2.id], kind: 'interpretation' }] }), es)!;
    expect(one).toEqual({ said: 'high', shown: 'medium', why: ["1 finding's quote wasn't found on its page"] });
    const disagree = answerConfidence(nb({ findings: [{ text: 'A', from: [own.id, tns.id, infoq.id] }], contradictions: [{ text: 'They differ on who governs it', from: [tns.id, infoq.id] }] }), es)!;
    expect(disagree.why).toEqual(['its sources disagree']);
    // A writer who already said low isn't raised, and says nothing about caps above it.
    expect(answerConfidence(nb({ confidence: 'low', findings: [{ text: 'A', from: [own.id] }] }), es)).toEqual({ said: 'low', shown: 'low', why: [] });
    expect(findingStatus(nb({}), { text: 'So C', from: [own.id], kind: 'interpretation' }, new Map(es.map((e) => [e.id, e])))).toBe('interpretation');
  });

  it('leaves an answer that cites no pages (a write-up from options) as the writer said', () => {
    expect(answerConfidence(nb({ findings: [{ text: 'A', from: ['option-1'] }] }), [])).toEqual({ said: 'high', shown: 'high', why: [] });
    expect(answerCitedIds({ findings: [{ text: 'A', from: ['a'] }], contradictions: [{ text: 'x', from: ['b', 'c'] }] })).toEqual(['a', 'b', 'c']);
  });

  it("keeps a finding's kind and contradictions with two sides as the writer gave them", () => {
    const ids = new Set(['a', 'b', 'c']);
    const a = cleanAnswer({ answer: 'Yes.', confidence: 'high', findings: [{ text: 'A says', from: ['a'], kind: 'fact' }, { text: 'So', from: ['b'], kind: 'opinion' }], contradictions: [{ text: 'They differ', from: ['a', 'b'] }, { text: 'One side only', from: ['a'] }, { text: 'Unknown ids', from: ['x', 'y'] }] }, ids, 'q', 'x', at)!;
    expect(a.findings).toEqual([{ text: 'A says', from: ['a'], kind: 'fact' }, { text: 'So', from: ['b'] }]);
    expect(a.contradictions).toEqual([{ text: 'They differ', from: ['a', 'b'] }]);
  });

  it('counts the pages found after the answer was written, and an answer counts as written work for a done-when', () => {
    const later = (url: string) => ({ ...page(url), createdAt: '2026-11-20T00:00:00.000Z' });
    const es = [own, later('https://a2ui.org/v1'), later('https://a2ui.org/v1#x'), later('https://thenewstack.io/new')];
    expect(answerNewSources(nb({}), es)).toEqual({ pages: 2, primary: 1, outside: 1 });
    expect(answerNewSources(nb({}), [own])).toBeUndefined();
    expect(answerNewSources(nb({ text: '' }), es)).toBeUndefined();
    expect(criterionMet(nb({}), [], 'The answer on how they differ written')).toBe(true);
    expect(criterionMet(nb({ text: '' }), [], 'The answer on how they differ written')).toBe(false);
  });

  it("a finding about options is tagged by how they did on the notebook's checks (each confirmed from the option's own page)", () => {
    const opt = (id: string, checked: string[]) => ({ id, notebookId: 'nb', kind: 'option', title: id, body: '', by: 'x', createdAt: at, checked } as unknown as NotebookEntry);
    const all = opt('o1', ['Open', 'Remote']), some = opt('o2', ['Open']), none = opt('o3', []);
    const byId = new Map([all, some, none].map((e) => [e.id, e]));
    const jobs = { ...nb({}), checks: ['Open', 'Remote'] };
    expect(findingStatus(jobs, { text: 'Lead', from: ['o1'] }, byId)).toBe('verified');
    expect(findingStatus(jobs, { text: 'Two', from: ['o1', 'o2'] }, byId)).toBe('supported');
    expect(findingStatus(jobs, { text: 'Rest', from: ['o3'] }, byId)).toBe('unverified');
    // No checks to go by: no word either way.
    expect(findingStatus({ ...jobs, checks: [] }, { text: 'Lead', from: ['o1'] }, byId)).toBeUndefined();
  });

  it('talking points written is something written: a briefing\'s points tick it', () => {
    const meeting = { ...nb({}), answer: undefined, steps: [{ id: 'w', title: 'Write', kind: 'write', status: 'done', tries: 0 }], briefing: { points: [{ text: 'Ask about the raise' }], questions: [], watch: [], at, by: 'x' } } as unknown as Notebook;
    expect(criterionMet(meeting, [], 'Talking points written')).toBe(true);
    expect(criterionMet({ ...meeting, briefing: undefined } as Notebook, [], 'Talking points written')).toBe(false);
  });
});

