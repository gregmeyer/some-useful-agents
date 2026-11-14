import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ExperimentStore, cleanFactors, cleanCases, cleanRanking, experimentConditions, conditionLevels, experimentRunCount, passProgress, EXPERIMENT_MAX_RUNS } from './experiments.js';
import { topKOverlap, rankShift, experimentVerdict, verdictWords } from './experiment-measures.js';
import { agentForCondition, conditionSettings, experimentAgentId, experimentAgentOf } from './experiment-conditions.js';
import type { Agent } from './agent-v2-types.js';

const FACTORS = [
  { name: 'Build', levels: [{ name: 'Rules A', instructions: 'Prefer seniority.' }, { name: 'Rules B', instructions: 'Prefer pay.', model: 'model-b', provider: 'codex' }] },
  { name: 'Preferences', levels: [{ name: 'Profile 1', inputs: { preferences: 'Remote only.' } }, { name: 'Profile 2', inputs: { preferences: 'Bay Area.' } }] },
];
const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, title: `Role ${id.toUpperCase()}`, facts: { Company: `Co ${id}`, Pay: 100 } }));

describe('experiment setup', () => {
  it('keeps factors with two or more named levels, and only what a level sets', () => {
    const f = cleanFactors([...FACTORS, { name: 'One level', levels: [{ name: 'Only' }] }, { levels: [{ name: 'x' }, { name: 'y' }] }, 'junk']);
    expect(f.map((x) => [x.id, x.levels.map((l) => l.id)])).toEqual([['build', ['rules-a', 'rules-b']], ['preferences', ['profile-1', 'profile-2']]]);
    expect(f[0].levels[1]).toEqual({ id: 'rules-b', name: 'Rules B', instructions: 'Prefer pay.', provider: 'codex', model: 'model-b' });
    expect(f[1].levels[0].inputs).toEqual({ PREFERENCES: 'Remote only.' });
    // Two levels of the same name stay two.
    expect(cleanFactors([{ name: 'M', levels: [{ name: 'Same' }, { name: 'Same' }] }])[0].levels.map((l) => l.id)).toEqual(['same', 'same-2']);
  });

  it('makes every combination a condition, the first levels first', () => {
    const f = cleanFactors(FACTORS);
    const c = experimentConditions(f);
    expect(c.map((x) => x.id)).toEqual(['rules-a+profile-1', 'rules-a+profile-2', 'rules-b+profile-1', 'rules-b+profile-2']);
    expect(c[3]).toMatchObject({ name: 'Rules B · Profile 2', levels: { build: 'rules-b', preferences: 'profile-2' } });
    expect(conditionLevels(f, c[3]).map((l) => l.name)).toEqual(['Rules B', 'Profile 2']);
    expect(experimentConditions([])).toEqual([{ id: 'as-it-is', name: 'As it is', levels: {} }]);
    expect(experimentRunCount({ factors: f, repeats: 3 }, 2)).toBe(24);
  });

  it('keeps a case of two or more items, with ids of its own and facts as short text', () => {
    const c = cleanCases([{ name: 'Jobs', items: [...ITEMS, { title: '' }, { id: 'a', title: 'Another A', facts: { Note: true, Empty: '' } }] }, { items: [{ title: 'Alone' }] }]);
    expect(c).toHaveLength(1);
    expect(c[0].items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'a-2']);
    expect(c[0].items[0].facts).toEqual({ Company: 'Co a', Pay: '100' });
    expect(c[0].items[6].facts).toEqual({ Note: 'true' });
  });

  it('takes a ranking only when it has every item once and nothing else', () => {
    expect(cleanRanking(['c', 'a', 'b'], ITEMS.slice(0, 3))).toEqual({ ranking: ['c', 'a', 'b'] });
    expect(cleanRanking(['c', 'a'], ITEMS.slice(0, 3))).toEqual({ error: 'It left out b. Rank every item.' });
    expect(cleanRanking(['c', 'a', 'a'], ITEMS.slice(0, 3))).toEqual({ error: '"a" is ranked twice.' });
    expect(cleanRanking(['c', 'a', 'zz'], ITEMS.slice(0, 3))).toEqual({ error: '"zz" is not one of the items\' ids.' });
    expect(cleanRanking('c, a, b', ITEMS)).toEqual({ error: 'It gave no list of ids.' });
  });
});

describe('ExperimentStore', () => {
  const fresh = () => ExperimentStore.fromHandle(new DatabaseSync(':memory:'));

  it('creates an experiment with its cases frozen, and refuses one it could not run', () => {
    const s = fresh();
    const e = s.create({ name: 'What changes job recommendations', question: 'Build or preferences?', task: { agentId: 'ranker' }, factors: FACTORS, cases: [{ name: 'Jobs', items: ITEMS }], from: { notebookId: 'jobs', title: 'Jobs' } });
    expect(e).toMatchObject({ id: 'what-changes-job-recommendations', kind: 'ranking', repeats: 3, topK: 5, task: { agentId: 'ranker' }, from: { notebookId: 'jobs' } });
    expect(s.cases(e.id)[0].items).toHaveLength(6);
    expect(s.create({ name: 'What changes job recommendations', task: { agentId: 'ranker' }, factors: [], cases: [{ items: ITEMS.slice(0, 3) }] })).toMatchObject({ id: 'what-changes-job-recommendations-2', topK: 2 });
    expect(s.fromNotebook('jobs').map((x) => x.id)).toEqual([e.id]);
    expect(() => s.create({ name: 'x', task: { agentId: 'ranker' }, factors: [], cases: [] })).toThrow('at least two items');
    expect(() => s.create({ name: 'x', task: { agentId: '' }, factors: [], cases: [{ items: ITEMS }] })).toThrow('Choose the agent');
    const many = [1, 2, 3].map((n) => ({ name: `F${String(n)}`, levels: [1, 2, 3].map((m) => ({ name: `L${String(m)}` })) }));
    expect(() => s.create({ name: 'x', task: { agentId: 'ranker' }, factors: many, cases: [{ items: ITEMS }] })).toThrow('27 conditions');
    expect(() => s.create({ name: 'x', task: { agentId: 'ranker' }, factors: FACTORS, repeats: 5, cases: [1, 2, 3, 4].map(() => ({ items: ITEMS })) })).toThrow(`80 runs a pass; ${String(EXPERIMENT_MAX_RUNS)} at most`);
    s.archive(e.id);
    expect(s.list().map((x) => x.id)).toEqual(['what-changes-job-recommendations-2']);
    expect(s.list({ archived: true })).toHaveLength(2);
  });

  it('runs a pass cell by cell: claimed once, stopped, resumed, and never lost to a restart', () => {
    const s = fresh();
    const e = s.create({ name: 'Pass', task: { agentId: 'ranker' }, factors: FACTORS, repeats: 2, cases: [{ items: ITEMS }] });
    const p = s.startPass(e.id, { taskVersion: 4 });
    expect(p.taskVersion).toBe(4);
    const cells = s.cells(p.id);
    expect(cells).toHaveLength(8);
    // Repeat by repeat: every condition once before any twice.
    expect(cells.slice(0, 4).every((c) => c.repeat === 1)).toBe(true);
    const a = s.claimCell(p.id)!;
    const b = s.claimCell(p.id)!;
    expect(a.id).not.toBe(b.id);
    expect(a.status).toBe('running');
    s.updateCell(a.id, { status: 'done', runId: 'run-1', ranking: ['a', 'b', 'c', 'd', 'e', 'f'], usedProvider: 'claude', agentVersion: 4, costUsd: 0.02 });
    s.updateCell(b.id, { status: 'invalid', error: 'It left out f. Rank every item.' });
    expect(s.cells(p.id).find((c) => c.id === a.id)).toMatchObject({ status: 'done', runId: 'run-1', ranking: ['a', 'b', 'c', 'd', 'e', 'f'], usedProvider: 'claude', agentVersion: 4, costUsd: 0.02 });
    expect(passProgress(s.cells(p.id))).toMatchObject({ total: 8, done: 1, invalid: 1, todo: 6, over: false, costUsd: 0.02 });
    // Stop: what hasn't run is stopped; resume puts it back (and the invalid one too, when asked).
    expect(s.stopPass(p.id)).toBe(6);
    expect(passProgress(s.cells(p.id)).over).toBe(true);
    expect(s.resumePass(p.id)).toBe(6);
    expect(s.resumePass(p.id, { retry: true })).toBe(1);
    expect(passProgress(s.cells(p.id))).toMatchObject({ done: 1, todo: 7 });
    // A restart with a cell running: its pass is stopped where it was, to be resumed.
    const c = s.claimCell(p.id)!;
    expect(s.stopInterrupted()).toEqual([p.id]);
    expect(s.cells(p.id).find((x) => x.id === c.id)).toMatchObject({ status: 'stopped', error: 'Cut off by a restart.' });
    expect(s.getPass(p.id)!.note).toBe('Cut off by a restart.');
    expect(s.resumePass(p.id)).toBe(7);
    expect(s.getPass(p.id)!.finishedAt).toBeUndefined();
    while (s.claimCell(p.id)) { /* take them all */ }
    expect(s.claimCell(p.id)).toBeUndefined();
    s.finishPass(p.id, '8 of 8');
    expect(s.passes(e.id)[0]).toMatchObject({ id: p.id, note: '8 of 8' });
  });
});

describe('experiment measures', () => {
  it('counts shared top items and places moved', () => {
    const a = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(topKOverlap(a, a, 3)).toBe(3);
    expect(rankShift(a, a)).toBe(0);
    const rev = [...a].reverse();
    expect(topKOverlap(a, rev, 3)).toBe(0);
    expect(rankShift(a, rev)).toBe(3); // 5+3+1+1+3+5 over 6
    expect(topKOverlap(a, ['b', 'a', 'd', 'c', 'e', 'f'], 3)).toBe(2);
  });

  const factors = [{ id: 'build', name: 'Build' }, { id: 'prefs', name: 'Preferences' }];
  const conditions = [
    { id: 'a1', name: 'A · 1', levels: { build: 'a', prefs: '1' } },
    { id: 'a2', name: 'A · 2', levels: { build: 'a', prefs: '2' } },
    { id: 'b1', name: 'B · 1', levels: { build: 'b', prefs: '1' } },
    { id: 'b2', name: 'B · 2', levels: { build: 'b', prefs: '2' } },
  ];
  const fwd = ['a', 'b', 'c', 'd', 'e', 'f'];
  const swapped = ['b', 'a', 'c', 'd', 'e', 'f'];
  const rev = [...fwd].reverse();
  const cell = (conditionId: string, repeat: number, ranking: string[]) => ({ caseId: 'jobs', conditionId, repeat, ranking });

  it('finds the factor that moved the result, against run-to-run variation', () => {
    // Build reverses the list; preferences change nothing; repeats differ by one swap in one condition.
    const cells = [cell('a1', 1, fwd), cell('a1', 2, swapped), cell('a2', 1, fwd), cell('a2', 2, fwd), cell('b1', 1, rev), cell('b1', 2, rev), cell('b2', 1, rev), cell('b2', 2, rev)];
    const v = experimentVerdict({ factors, conditions, cells, topK: 3 });
    expect(v.n).toEqual({ cases: 1, conditions: 4, repeats: 2, rankings: 8 });
    expect(v.noise).toMatchObject({ pairs: 4, overlapMin: 3 });
    expect(v.noise!.shiftMax).toBeCloseTo(1 / 3);
    expect(v.effects.map((e) => [e.name, e.beyondNoise])).toEqual([['Build', true], ['Preferences', false]]);
    expect(v.effects[0].overlap).toBe(0);
    expect(v.effects[0].pairs).toBe(8);
    // Each change by itself: build with preferences held at 1, then at 2.
    expect(v.effects[0].parts.map((p) => [p.from, p.to, p.overlap])).toEqual([['a1', 'b1', 0], ['a2', 'b2', 0]]);
    expect(v.effects[1].parts.map((p) => [p.from, p.to])).toEqual([['a1', 'a2'], ['b1', 'b2']]);
    expect(v.conditions.map((c) => [c.id, c.vsBaseline?.overlap])).toEqual([['a1', undefined], ['a2', 3], ['b1', 0], ['b2', 0]]);
    // The items that moved furthest lead the table: a is 1st (or 2nd) under A and last under B.
    expect(v.items[0].ranks).toMatchObject({ a2: 1, b1: 6 });
    expect(['a', 'f']).toContain(v.items[0].id);
    const w = verdictWords(v);
    expect(w.headline).toBe('Build changed the result; preferences did not, beyond run-to-run variation.');
    expect(w.lines[0]).toBe('Changing build: 0 of the top 3 stayed, and an item moved 3 places on average.');
    expect(w.sample).toBe('1 set, 4 conditions, 2 runs of each. It holds for this set only.');
  });

  it('says nothing can be concluded when a difference is no larger than a repeat\'s, or there were no repeats', () => {
    // Every pair of runs differs by the same swap or not at all: no factor stands out.
    const noisy = [cell('a1', 1, fwd), cell('a1', 2, swapped), cell('a2', 1, swapped), cell('a2', 2, fwd), cell('b1', 1, fwd), cell('b1', 2, swapped), cell('b2', 1, swapped), cell('b2', 2, fwd)];
    const v = experimentVerdict({ factors, conditions, cells: noisy, topK: 3 });
    expect(v.effects.every((e) => e.beyondNoise === false)).toBe(true);
    expect(verdictWords(v).headline).toBe('No factor changed the result more than running the same thing twice did.');
    const once = experimentVerdict({ factors, conditions, cells: [cell('a1', 1, fwd), cell('a2', 1, fwd), cell('b1', 1, rev), cell('b2', 1, rev)], topK: 3 });
    expect(once.noise).toBeUndefined();
    expect(once.effects[0].beyondNoise).toBeUndefined();
    expect(verdictWords(once).headline).toContain('Each condition was run once');
    expect(verdictWords(experimentVerdict({ factors, conditions, cells: [], topK: 3 })).headline).toBe('Nothing has been run yet.');
    // Both factors move it, one much more.
    const both = [cell('a1', 1, fwd), cell('a1', 2, fwd), cell('a2', 1, swapped), cell('a2', 2, swapped), cell('b1', 1, rev), cell('b1', 2, rev), cell('b2', 1, [...swapped].reverse()), cell('b2', 2, [...swapped].reverse())];
    expect(verdictWords(experimentVerdict({ factors, conditions, cells: both, topK: 3 })).headline).toBe('Build changed the result more than preferences did.');
  });
});

describe('a condition as an agent to run', () => {
  const agent = { id: 'ranker', name: 'Ranker', status: 'active', schedule: '0 9 * * *', version: 3, nodes: [{ id: 'fetch', type: 'shell', command: 'echo' }, { id: 'rank', type: 'llm-prompt', prompt: 'Rank', provider: 'claude' }] } as unknown as Agent;

  it('runs under an experiment\'s id with the condition\'s provider and model on its model nodes, never scheduled', () => {
    const levels = cleanFactors(FACTORS).map((f) => f.levels[1]);
    expect(conditionSettings(levels)).toEqual({ provider: 'codex', model: 'model-b', inputs: { INSTRUCTIONS: 'Prefer pay.', PREFERENCES: 'Bay Area.' } });
    const run = agentForCondition(agent, levels);
    expect(run.id).toBe('experiment--ranker');
    expect(run.schedule).toBeUndefined();
    expect(run).toMatchObject({ provider: 'codex', model: 'model-b' });
    expect(run.nodes[0]).toEqual(agent.nodes[0]);
    expect(run.nodes[1]).toMatchObject({ id: 'rank', provider: 'codex', model: 'model-b', prompt: 'Rank' });
    // A condition that names neither leaves the agent's own choice alone.
    expect(agentForCondition(agent, [{ id: 'x', name: 'X' }]).nodes[1]).toEqual(agent.nodes[1]);
    expect(agent.id).toBe('ranker');
    expect(experimentAgentOf(experimentAgentId('ranker'))).toBe('ranker');
    expect(experimentAgentOf('ranker')).toBeUndefined();
  });
});
