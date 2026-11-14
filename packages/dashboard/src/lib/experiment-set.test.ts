import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { NotebookStore } from '@some-useful-agents/core';
import { goldenSet, rankSetCandidates, setCandidate, topicWords, GOLDEN_SIZE } from './experiment-set.js';

function notebook(title: string, statement: string, rows: Array<{ title: string; pay?: number; remote?: string }>) {
  const s = NotebookStore.fromHandle(new DatabaseSync(':memory:'));
  const nb = s.create({ title, statement, params: [], criteria: [] });
  s.setFields(nb.id, [{ key: 'pay', label: 'Pay', type: 'money', role: 'price', better: 'higher' }, { key: 'remote', label: 'Remote', type: 'text' }]);
  const ids = rows.map((r) => s.upsertOption(nb.id, { title: r.title, data: { ...(r.pay !== undefined ? { pay: r.pay } : {}), ...(r.remote ? { remote: r.remote } : {}) }, by: 'you' }).entry.id);
  return { s, id: nb.id, ids, get: () => ({ nb: s.get(nb.id)!, entries: s.entries(nb.id, 1000) }) };
}

describe('which set an experiment should hold fixed', () => {
  it('reads what a sentence is about', () => {
    expect(topicWords('Does the way the job agent is built change its recommendations?')).toEqual(['job', 'agent', 'built', 'recommendation']);
  });

  it('uses a short list whole, with its picks as the answer key and what was ruled out to be kept low', () => {
    const n = notebook('Jobs', 'Find jobs', [{ title: 'Role A', pay: 300 }, { title: 'Role B', pay: 250 }, { title: 'Role C', pay: 200 }, { title: 'Role D', pay: 150 }]);
    n.s.ruleOut(n.id, n.ids[3], 'Too junior', 'you');
    n.s.choose(n.id, n.ids[1]);
    const { nb, entries } = n.get();
    const g = goldenSet(nb, entries);
    expect(g).toMatchObject({ trimmed: false, size: 4, of: 4, key: { ids: [n.ids[1]], names: ['Role B'], by: 'you' }, low: [n.ids[3]] });
    expect(g.items.map((i) => [i.name, i.why, i.inSet])).toEqual([['Role A', 'all', true], ['Role B', 'pick', true], ['Role C', 'all', true], ['Role D', 'ruled-out', true]]);
    expect(g.items[3].reason).toBe('Too junior');
  });

  it('trims a long list to a golden set: the picks, a spread from best to worst, and two ruled out', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ title: `Role ${String(i + 1).padStart(2, '0')}`, pay: 400 - i * 10 }));
    const n = notebook('Jobs', 'Find jobs', rows);
    for (const i of [17, 18, 19]) n.s.ruleOut(n.id, n.ids[i], `Reason ${String(i)}`, 'you');
    n.s.choose(n.id, n.ids[4]);
    n.s.choose(n.id, n.ids[9]);
    const { nb, entries } = n.get();
    const g = goldenSet(nb, entries);
    expect(g.trimmed).toBe(true);
    expect(g.size).toBe(GOLDEN_SIZE);
    expect(g.across).toBe('pay');
    const inSet = g.items.filter((i) => i.inSet);
    expect(inSet.filter((i) => i.why === 'pick').map((i) => i.name)).toEqual(['Role 05', 'Role 10']);
    expect(inSet.filter((i) => i.why === 'ruled-out')).toHaveLength(2);
    const spread = inSet.filter((i) => i.why === 'spread').map((i) => i.name);
    expect(spread).toHaveLength(6);
    // The best and the worst of the rest are both in it.
    expect(spread[0]).toBe('Role 01');
    expect(spread[spread.length - 1]).toBe('Role 17');
    // Every option is listed, so any can be ticked back in.
    expect(g.items).toHaveLength(20);
  });

  it('says what speaks for and against each notebook, and suggests the one that fits the question', () => {
    const jobs = notebook('Find fitting jobs', 'Senior job openings that fit', Array.from({ length: 6 }, (_, i) => ({ title: `Job ${String(i)}`, pay: 100 + i, remote: 'yes' })));
    jobs.s.choose(jobs.id, jobs.ids[0]);
    jobs.s.choose(jobs.id, jobs.ids[1]);
    const cars = notebook('Buy a car', 'A used car under $10k', Array.from({ length: 12 }, (_, i) => ({ title: `Car ${String(i)}`, pay: 9000 - i })));
    const thin = notebook('Job leads', 'Jobs to look at', [{ title: 'Lead A' }, { title: 'Lead B' }, { title: 'Lead C' }]);
    const q = 'Does the way the job agent is built change which jobs it recommends?';
    const cands = [cars, thin, jobs].map((n) => { const { nb, entries } = n.get(); return setCandidate(nb, entries, q); });
    const ranked = rankSetCandidates(cands);
    expect(ranked.map((c) => [c.title, c.suggested ?? false])).toEqual([['Find fitting jobs', true], ['Buy a car', false], ['Job leads', false]]);
    expect(ranked[0].why).toEqual(['about job, as your question is', 'pay and remote noted for every option', 'you picked 2 of them, so results can be scored against your picks']);
    expect(ranked[0].but).toEqual([]);
    expect(ranked[1].but).toEqual(['not about what your question asks']);
    // A list too short to tell anything from goes last, though its title matches the question.
    expect(ranked[2].matched).toEqual(['job']);
    expect(ranked[2].but).toEqual(['only 3 options, so results will be coarse', 'few facts noted, so there is little for the agent to rank by']);
    // And is never the suggestion, even alone with a match.
    expect(rankSetCandidates([cands[1]])[0].suggested).toBeUndefined();
    // With nothing to tell them apart but size, none is suggested.
    const plain = rankSetCandidates([cars, thin].map((n) => { const { nb, entries } = n.get(); return setCandidate(nb, entries, ''); }));
    expect(plain.some((c) => c.suggested)).toBe(false);
    expect(plain[0].title).toBe('Buy a car');
  });
});
