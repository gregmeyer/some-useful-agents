import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { NotebookStore } from '@some-useful-agents/core';
import { applySetAdvice, goldenSet, parseSetAdvice, rankSetCandidates, setAdviceInputs, setCandidate, topicWords, GOLDEN_SIZE } from './experiment-set.js';

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

  it('takes sua\'s reading of the question only as far as the sets bear it out', () => {
    const jobs = notebook('Find fitting jobs', 'Job openings that fit', Array.from({ length: 6 }, (_, i) => ({ title: `Job ${String(i)}`, pay: 100 + i, ...(i < 2 ? { remote: 'yes' } : {}) })));
    const roles = notebook('Senior roles', 'Roles to apply for', Array.from({ length: 8 }, (_, i) => ({ title: `Role ${String(i)}`, pay: 200 + i, remote: i % 2 ? 'yes' : 'no' })));
    const tiny = notebook('Two leads', 'Leads', [{ title: 'A', pay: 1, remote: 'yes' }, { title: 'B', pay: 2, remote: 'no' }]);
    const q = 'Does the job agent rank by pay more than by what the person wants about remote work?';
    const cands = rankSetCandidates([jobs, roles, tiny].map((n) => { const { nb, entries } = n.get(); return setCandidate(nb, entries, q); }));
    // Counted alone, the notebook whose title matches leads.
    expect(cands[0]).toMatchObject({ title: 'Find fitting jobs', suggested: true });
    // What the advisor is shown: each set's facts with how many options note them, and two examples.
    const sets = JSON.parse(setAdviceInputs(q, 'Build: A | B', cands).SETS) as Array<{ title: string; facts: unknown[]; examples: Array<{ title: string; facts: Record<string, string> }> }>;
    expect(sets.find((x) => x.title === 'Find fitting jobs')!.facts).toEqual([{ label: 'Pay', notedFor: '6 of 6' }, { label: 'Remote', notedFor: '2 of 6' }]);
    expect(sets.find((x) => x.title === 'Senior roles')!.examples[0]).toEqual({ title: 'Role 0', facts: { Pay: '$200', Remote: 'no' } });

    const answer = (o: unknown) => `<advice>${JSON.stringify(o)}</advice>`;
    // A fact no set notes is dropped; a pick that isn't one of the sets is dropped; with nothing left it's refused.
    expect(parseSetAdvice(answer({ turnsOn: [{ fact: 'Seniority' }], pick: 'made-up', why: 'x' }), cands)).toEqual({ error: 'It names no fact that any set notes (copy a label exactly) and picks no listed set.' });
    expect(parseSetAdvice('no block', cands)).toEqual({ error: 'It has no <advice> JSON object.' });
    const out = parseSetAdvice(answer({ turnsOn: [{ fact: 'pay', because: 'the build ranks by it' }, { fact: 'Remote' }, { fact: 'Seniority' }, { fact: 'Pay' }], pick: roles.id, why: 'Its roles differ in both pay and remote.', missing: ['seniority'] }), cands);
    expect(out).toEqual({ advice: { turnsOn: [{ fact: 'Pay', because: 'the build ranks by it' }, { fact: 'Remote' }], pick: roles.id, why: 'Its roles differ in both pay and remote.', missing: ['seniority'] } });
    const advice = 'advice' in out ? out.advice : undefined;

    // Laid over the counted ranking: each set says how many options note those facts (counted here), and the suggestion moves to the one that has them.
    const read = applySetAdvice(cands, advice!);
    expect(read.map((c) => [c.title, c.suggested ?? false])).toEqual([['Senior roles', true], ['Find fitting jobs', false], ['Two leads', false]]);
    expect(read[0]).toMatchObject({ reading: 'Its roles differ in both pay and remote.', turnsOn: [{ label: 'Pay', noted: 8 }, { label: 'Remote', noted: 8 }] });
    expect(read[1].turnsOn).toEqual([{ label: 'Pay', noted: 6 }, { label: 'Remote', noted: 2 }]);
    expect(read[1].but).toContain('remote, which your question turns on, is noted for 2 of 6');
    // A notebook's own name for the same fact counts; one with no such fact says so, not "0 of N".
    const named = notebook('Other jobs', 'Jobs', [{ title: 'X', pay: 1 }, { title: 'Y', pay: 2 }, { title: 'Z', pay: 3 }, { title: 'W', pay: 4 }, { title: 'V', pay: 5 }]);
    named.s.setFields(named.id, [{ key: 'pay', label: 'Pay', type: 'money', role: 'price' }, { key: 'remote', label: 'Remote status', type: 'text' }]);
    for (const id of named.ids.slice(0, 4)) named.s.setOptionFacts(named.id, id, { remote: 'yes' });
    const { nb: nnb, entries: nen } = named.get();
    const other = applySetAdvice([setCandidate(nnb, nen, q)], { turnsOn: [{ fact: 'Remote' }, { fact: 'Level' }], missing: [] })[0];
    expect(other.turnsOn).toEqual([{ label: 'Remote', noted: 4, as: 'Remote status' }, { label: 'Level' }]);
    expect(other.but).toContain('it notes nothing called level, which your question turns on');
    // sua picking a set too small, or one that lacks those facts, doesn't move the suggestion.
    expect(applySetAdvice(cands, { ...advice!, pick: tiny.id })[0]).toMatchObject({ title: 'Find fitting jobs', suggested: true });
    expect(applySetAdvice(cands, { ...advice!, pick: jobs.id }).find((c) => c.title === 'Find fitting jobs')!.reading).toBeUndefined();
  });
});
