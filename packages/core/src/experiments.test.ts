import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ExperimentStore, cleanFactors, cleanInputs, cleanScorers, cleanJudgement, foundScore, scoreSummaries, experimentConditions, conditionLevels, experimentRunCount, passProgress, EXPERIMENT_MAX_RUNS } from './experiments.js';
import { outputDifference, experimentVerdict, verdictWords } from './experiment-measures.js';
import { readOutput, itemKey, linkKey } from './experiment-output.js';
import { agentForCondition, conditionSettings, experimentAgentId, experimentAgentOf } from './experiment-conditions.js';
import { experimentLayout, experimentPageData, missingExperimentData } from './experiment-notebook.js';
import { experimentReadoutJson, experimentReadoutText, findExperiment, readExperiment } from './experiment-readout.js';
import { checkNotebookLayout } from './notebook-layout.js';
import { NotebookStore } from './notebooks.js';
import { getBuiltinTool } from './builtin-tools.js';
import { policyResource } from './policy-store.js';
import type { Agent } from './agent-v2-types.js';

const FACTORS = [
  { name: 'Build', levels: [{ name: 'Old', version: 3 }, { name: 'New', version: 4, model: 'model-b', provider: 'codex' }] },
  { name: 'Preferences', levels: [{ name: 'Remote', inputs: { PREFERENCES: 'Remote only.' } }, { name: 'Office', inputs: { PREFERENCES: 'Bay Area.' } }] },
];
const item = (title: string, link?: string) => ({ key: itemKey(title, link), title, ...(link ? { link } : {}), facts: {} });

describe('what a run produced', () => {
  it('reads a list of items out of JSON anywhere in the output, with a key that is the same in another run', () => {
    const jobs = [
      { title: 'Staff Engineer', company: 'Acme', url: 'https://www.acme.example/jobs/12?utm=x', salary: { min: 200000, max: 250000 }, remote: true, id: 7 },
      { title: 'Staff Engineer', company: 'Globex', remote: false },
      { name: 'Designer', employer: 'Initech' },
    ];
    const out = readOutput(`Here they are.\n\`\`\`json\n${JSON.stringify({ jobs, log: ['a', 'b'] })}\n\`\`\``);
    expect(out.listed).toBe(true);
    expect(out.items).toEqual([
      { key: 'link:acme.example/jobs/12', title: 'Staff Engineer', link: 'https://www.acme.example/jobs/12?utm=x', facts: { Company: 'Acme', Salary: '200000–250000', Remote: 'yes' } },
      { key: 'name:staff engineer | globex', title: 'Staff Engineer', facts: { Company: 'Globex', Remote: 'no' } },
      { key: 'name:designer | initech', title: 'Designer', facts: { Employer: 'Initech' } },
    ]);
    // The same job from another run, worded a little differently and with tracking on its link, is the same item.
    expect(readOutput(JSON.stringify([{ role: 'Staff Engineer (Platform)', link: 'https://acme.example/jobs/12/?ref=y' }])).items[0].key).toBe('link:acme.example/jobs/12');
    expect(itemKey('Staff  Engineer!', undefined, 'GLOBEX')).toBe('name:staff engineer | globex');
    expect(linkKey('not a link')).toBeUndefined();
  });

  it('reads a plain list, tells an empty result from no list at all, and keeps one of each', () => {
    expect(readOutput('Found:\n- **Role A** at Acme (https://x.example/a)\n- Role B\n- Role B\n2. Role C').items.map((i) => [i.title, i.key])).toEqual([['Role A at Acme', 'link:x.example/a'], ['Role B', 'name:role b'], ['Role C', 'name:role c']]);
    // It listed nothing, on purpose: a result. It has no list: not one.
    expect(readOutput('{"jobs": []}')).toEqual({ listed: true, items: [] });
    expect(readOutput('[]')).toEqual({ listed: true, items: [] });
    expect(readOutput('Nothing found today.')).toEqual({ listed: false, items: [] });
    expect(readOutput(JSON.stringify({ steps: [{ ok: true }, { ok: false }] })).listed).toBe(false);
    expect(readOutput(undefined)).toEqual({ listed: false, items: [] });
  });
});

describe('experiment setup', () => {
  it('keeps changes with two or more named versions, and only what a version sets', () => {
    const f = cleanFactors([...FACTORS, { name: 'One version', levels: [{ name: 'Only' }] }, { levels: [{ name: 'x' }, { name: 'y' }] }, 'junk']);
    expect(f.map((x) => [x.id, x.levels.map((l) => l.id)])).toEqual([['build', ['old', 'new']], ['preferences', ['remote', 'office']]]);
    expect(f[0].levels[1]).toEqual({ id: 'new', name: 'New', version: 4, provider: 'codex', model: 'model-b' });
    expect(f[1].levels[0].inputs).toEqual({ PREFERENCES: 'Remote only.' });
    expect(cleanInputs({ 'TOPIC': ' jobs ', 'bad key!': 'x', EMPTY: '', N: 3 })).toEqual({ TOPIC: 'jobs', badkey: 'x', N: '3' });
  });

  it('makes every combination a version to run, the first of each first', () => {
    const f = cleanFactors(FACTORS);
    const c = experimentConditions(f);
    expect(c.map((x) => x.id)).toEqual(['old+remote', 'old+office', 'new+remote', 'new+office']);
    expect(c[3]).toMatchObject({ name: 'New · Office', levels: { build: 'new', preferences: 'office' } });
    expect(conditionLevels(f, c[3]).map((l) => l.name)).toEqual(['New', 'Office']);
    expect(experimentConditions([])).toEqual([{ id: 'as-it-is', name: 'As it is', levels: {} }]);
    expect(experimentRunCount({ factors: f, repeats: 3 })).toBe(12);
    expect(experimentRunCount({ factors: f, repeats: 3, scorers: [{ id: 'j', name: 'J', kind: 'judge', rubric: 'x' }] })).toBe(24);
  });

  it('a version is the agent under an experiment\'s id, with its provider and model on its model steps, never scheduled', () => {
    const agent = { id: 'finder', name: 'Finder', status: 'active', schedule: '0 9 * * *', version: 3, nodes: [{ id: 'fetch', type: 'shell', command: 'echo' }, { id: 'think', type: 'llm-prompt', prompt: 'Find', provider: 'claude' }] } as unknown as Agent;
    const levels = cleanFactors(FACTORS).map((f) => f.levels[1]);
    expect(conditionSettings(levels)).toEqual({ version: 4, provider: 'codex', model: 'model-b', inputs: { PREFERENCES: 'Bay Area.' } });
    const run = agentForCondition(agent, levels);
    expect(run.id).toBe('experiment--finder');
    expect(run.schedule).toBeUndefined();
    expect(run.nodes[0]).toEqual(agent.nodes[0]);
    expect(run.nodes[1]).toMatchObject({ id: 'think', provider: 'codex', model: 'model-b', prompt: 'Find' });
    expect(agentForCondition(agent, [{ id: 'x', name: 'X' }]).nodes[1]).toEqual(agent.nodes[1]);
    expect(experimentAgentOf(experimentAgentId('finder'))).toBe('finder');
    expect(experimentAgentOf('finder')).toBeUndefined();
  });
});

describe('ExperimentStore', () => {
  const fresh = () => ExperimentStore.fromHandle(new DatabaseSync(':memory:'));

  it('creates an experiment with its ask, and refuses one it could not run', () => {
    const s = fresh();
    const e = s.create({ name: 'Does the new version find different jobs', question: 'Old or new?', task: { agentId: 'finder' }, inputs: { TOPIC: 'staff jobs' }, factors: FACTORS });
    expect(e).toMatchObject({ id: 'does-the-new-version-find-different-jobs', kind: 'outputs', repeats: 2, task: { agentId: 'finder' }, inputs: { TOPIC: 'staff jobs' } });
    expect(s.create({ name: 'Does the new version find different jobs', task: { agentId: 'finder' }, factors: [] }).id).toBe('does-the-new-version-find-different-2');
    expect(() => s.create({ name: 'x', task: { agentId: '' }, factors: [] })).toThrow('Choose the agent');
    const many = [1, 2, 3].map((n) => ({ name: `F${String(n)}`, levels: [1, 2, 3].map((m) => ({ name: `L${String(m)}` })) }));
    expect(() => s.create({ name: 'x', task: { agentId: 'finder' }, factors: many })).toThrow('27 versions to run');
    expect(() => s.create({ name: 'x', task: { agentId: 'finder' }, factors: FACTORS, repeats: 5, scorers: [{ kind: 'judge', rubric: 'Good.' }] })).toThrow(`40 runs a pass (each judge reads every result); ${String(EXPERIMENT_MAX_RUNS)} at most`);
    s.archive(e.id);
    expect(s.list().map((x) => x.id)).toEqual(['does-the-new-version-find-different-2']);
    expect(s.list({ archived: true })).toHaveLength(2);
  });

  it('runs a pass cell by cell: claimed once, stopped, resumed, and never lost to a restart', () => {
    const s = fresh();
    const e = s.create({ name: 'Pass', task: { agentId: 'finder' }, factors: FACTORS, repeats: 2 });
    const p = s.startPass(e.id, { taskVersion: 4 });
    expect(p.taskVersion).toBe(4);
    const cells = s.cells(p.id);
    expect(cells).toHaveLength(8);
    expect(cells.slice(0, 4).every((c) => c.repeat === 1)).toBe(true);
    const a = s.claimCell(p.id)!;
    const b = s.claimCell(p.id)!;
    expect(a.id).not.toBe(b.id);
    s.updateCell(a.id, { status: 'done', runId: 'run-1', items: [item('Role A')], usedProvider: 'claude', agentVersion: 4, costUsd: 0.4 });
    s.updateCell(b.id, { status: 'invalid', error: 'Its output has no list.' });
    expect(s.cells(p.id).find((c) => c.id === a.id)).toMatchObject({ status: 'done', runId: 'run-1', items: [{ title: 'Role A' }], usedProvider: 'claude', agentVersion: 4, costUsd: 0.4 });
    expect(passProgress(s.cells(p.id))).toMatchObject({ total: 8, done: 1, invalid: 1, todo: 6, over: false, costUsd: 0.4 });
    expect(s.stopPass(p.id)).toBe(6);
    expect(s.resumePass(p.id)).toBe(6);
    expect(s.resumePass(p.id, { retry: true })).toBe(1);
    const c = s.claimCell(p.id)!;
    expect(s.stopInterrupted()).toEqual([p.id]);
    expect(s.cells(p.id).find((x) => x.id === c.id)).toMatchObject({ status: 'stopped', error: 'Cut off by a restart.' });
    expect(s.resumePass(p.id)).toBe(7);
    while (s.claimCell(p.id)) { /* take them all */ }
    s.finishPass(p.id, '8 of 8');
    expect(s.passes(e.id)[0]).toMatchObject({ id: p.id, note: '8 of 8' });
  });
});

describe('experiment measures', () => {
  it('counts what two outputs share, and how far apart the shared items sit', () => {
    expect(outputDifference(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual({ shared: 3, of: 3, share: 1, shift: 0 });
    expect(outputDifference(['a', 'b', 'c'], ['c', 'b', 'a'])).toMatchObject({ shared: 3, of: 3, share: 1 });
    expect(outputDifference(['a', 'b', 'c'], ['c', 'b', 'a']).shift).toBeCloseTo(4 / 3);
    // Half in common; an item only one found doesn't push the shared ones apart.
    expect(outputDifference(['a', 'x', 'b'], ['a', 'b', 'y'])).toEqual({ shared: 2, of: 4, share: 0.5, shift: 0 });
    expect(outputDifference(['a'], ['b'])).toMatchObject({ shared: 0, of: 2, share: 0 });
    expect(outputDifference([], [])).toMatchObject({ shared: 0, of: 0, share: 1 });
  });

  const factors = [{ id: 'build', name: 'Build' }, { id: 'prefs', name: 'Preferences' }];
  const conditions = [
    { id: 'a1', name: 'A · 1', levels: { build: 'a', prefs: '1' } },
    { id: 'a2', name: 'A · 2', levels: { build: 'a', prefs: '2' } },
    { id: 'b1', name: 'B · 1', levels: { build: 'b', prefs: '1' } },
    { id: 'b2', name: 'B · 2', levels: { build: 'b', prefs: '2' } },
  ];
  const cell = (conditionId: string, repeat: number, keys: string[]) => ({ conditionId, repeat, keys });
  const old = ['j1', 'j2', 'j3', 'j4'];
  const neu = ['j1', 'j5', 'j6', 'j7'];

  it('finds the change that altered what was produced, against run-to-run variation', () => {
    // The new build finds mostly other jobs; preferences change nothing; one repeat misses one job.
    const cells = [cell('a1', 1, old), cell('a1', 2, old.slice(0, 3)), cell('a2', 1, old), cell('a2', 2, old), cell('b1', 1, neu), cell('b1', 2, neu), cell('b2', 1, neu), cell('b2', 2, neu)];
    const v = experimentVerdict({ factors, conditions, cells });
    expect(v.n).toEqual({ conditions: 4, repeats: 2, outputs: 8 });
    expect(v.noise).toMatchObject({ pairs: 4, shareMin: 0.75 });
    expect(v.effects.map((e) => [e.name, e.beyondNoise])).toEqual([['Build', true], ['Preferences', false]]);
    expect(v.effects[0].pairs).toBe(8);
    expect(v.effects[0].share).toBeLessThan(0.2);
    expect(v.effects[0].parts.map((p) => [p.from, p.to])).toEqual([['a1', 'b1'], ['a2', 'b2']]);
    expect(v.conditions.map((c) => [c.id, c.items, c.vsBaseline ? Math.round(c.vsBaseline.share * 100) : undefined])).toEqual([['a1', 3.5, undefined], ['a2', 4, 88], ['b1', 4, 15], ['b2', 4, 15]]);
    // The jobs only one build found lead; the one both found comes after.
    expect(v.items[0].spread).toBe(1);
    expect(v.items.find((i) => i.key === 'j1')).toMatchObject({ found: { a1: 1, a2: 1, b1: 1, b2: 1 }, place: { a1: 1 }, spread: 0 });
    expect(v.items.find((i) => i.key === 'j4')!.found).toEqual({ a1: 0.5, a2: 1, b1: 0, b2: 0 });
    const w = verdictWords(v);
    expect(w.headline).toBe('Build changed what it produced; preferences did not, beyond run-to-run variation.');
    expect(w.lines[0]).toMatch(/^Changing build: 1 of 6\.\d items were in both versions' results, on average\.$/);
    expect(w.lines[2]).toBe('Running the same version again: 3.8 of 4 items were in both runs\' results, on average.');
    expect(w.sample).toBe('4 versions, 2 runs of each. It holds for this ask, when it was run.');
  });

  it('says nothing can be concluded when versions differ no more than repeats do, or there were no repeats', () => {
    // Every run finds three of the same four, a different three each time.
    const noisy = [cell('a1', 1, ['j1', 'j2', 'j3']), cell('a1', 2, ['j2', 'j3', 'j4']), cell('b1', 1, ['j1', 'j3', 'j4']), cell('b1', 2, ['j1', 'j2', 'j4'])];
    const two = [conditions[0], conditions[2]];
    const v = experimentVerdict({ factors: [factors[0]], conditions: two, cells: noisy });
    expect(v.effects[0].beyondNoise).toBe(false);
    expect(verdictWords(v).headline).toBe('No change altered what it produced more than running the same version twice did.');
    const once = experimentVerdict({ factors: [factors[0]], conditions: two, cells: [cell('a1', 1, old), cell('b1', 1, neu)] });
    expect(once.noise).toBeUndefined();
    expect(verdictWords(once).headline).toContain('Each version was run once');
    expect(verdictWords(experimentVerdict({ factors, conditions, cells: [] })).headline).toBe('Nothing has been run yet.');
    // Nothing changed: it reports how steady the agent is.
    const steady = experimentVerdict({ factors: [], conditions: [{ id: 'as-it-is', name: 'As it is', levels: {} }], cells: [cell('as-it-is', 1, old), cell('as-it-is', 2, old.slice(0, 2))] });
    expect(verdictWords(steady).headline).toBe('Nothing was changed, so this shows only how steady it is: two runs of the same thing shared 50% of what they found.');
  });
});

describe('scoring each result', () => {
  it('counts named things found or left out, by words from a title or part of a link', () => {
    const sc = cleanScorers([
      { kind: 'found', name: 'Has the Acme roles', items: ['acme', 'jobs/12', 'nowhere'] },
      { kind: 'found', avoid: true, items: ['intern'] },
      { kind: 'judge', name: 'All remote', rubric: 'Every job is remote.', provider: 'codex' },
      { kind: 'judge', rubric: '' }, { kind: 'found', items: [] }, { kind: 'other' },
    ]);
    expect(sc.map((x) => [x.id, x.kind])).toEqual([['has-the-acme-roles', 'found'], ['left-out', 'found'], ['all-remote', 'judge']]);
    const items = [item('Staff Engineer at Acme'), item('Designer', 'https://x.example/jobs/12'), item('Summer Intern')];
    expect(foundScore(sc[0] as never, items)).toBeCloseTo(2 / 3);
    expect(foundScore(sc[1] as never, items)).toBe(0);
    expect(foundScore(sc[1] as never, items.slice(0, 2))).toBe(1);
    expect(foundScore(sc[0] as never, [])).toBe(0);
  });

  it('takes a judge\'s answer only as a number from 0 to 1 with a reason that points at items in the list', () => {
    expect(cleanJudgement({ score: 0.8, reason: 'The first two are remote.', cites: [1, 2, 2] }, 5)).toEqual({ value: 0.8, reason: 'The first two are remote.', cites: ['1', '2'] });
    expect(cleanJudgement({ score: 1.2, reason: 'x', cites: [1] }, 5)).toEqual({ error: 'Its score is not a number from 0 to 1.' });
    expect(cleanJudgement({ score: 0.5, cites: [1] }, 5)).toEqual({ error: 'It gave no reason.' });
    expect(cleanJudgement({ score: 0.5, reason: 'Looks fine.' }, 5)).toEqual({ error: 'It cites no item. Give the numbers of the items its reason rests on.' });
    expect(cleanJudgement({ score: 0.5, reason: 'Looks fine.', cites: [9] }, 5)).toEqual({ error: 'It cites item 9, and the list has 5.' });
    // A run that listed nothing can be judged on that alone.
    expect(cleanJudgement({ score: 0, reason: 'It found nothing.', cites: [] }, 0)).toEqual({ value: 0, reason: 'It found nothing.', cites: [] });
  });

  it('averages every scorer by version, leaving out a judge that gave no usable score', () => {
    const s = ExperimentStore.fromHandle(new DatabaseSync(':memory:'));
    const e = s.create({ name: 'Scored', task: { agentId: 'finder' }, factors: [FACTORS[0]], repeats: 2, scorers: [{ kind: 'found', name: 'Has A', items: ['role a'] }, { kind: 'judge', name: 'Judge', rubric: 'Good.' }] });
    const p = s.startPass(e.id);
    const [c1, c2, c3] = s.cells(p.id);
    s.updateCell(c1.id, { status: 'done', items: [item('Role A'), item('Role B')] });
    s.updateCell(c2.id, { status: 'done', items: [item('Role C')] });
    s.updateCell(c3.id, { status: 'done', items: [item('Role B')] });
    s.setScore(p.id, { cellId: c1.id, scorerId: 'judge', value: 0.9, reason: 'Good.', cites: ['1'], runId: 'r1' });
    s.setScore(p.id, { cellId: c3.id, scorerId: 'judge', value: 0.5, reason: 'Half.', cites: ['1'] });
    s.setScore(p.id, { cellId: c2.id, scorerId: 'judge', error: 'It has no <score> block.' });
    const sums = scoreSummaries(e.scorers, s.cells(p.id), s.scores(p.id));
    expect(sums.find((x) => x.scorerId === 'has-a' && x.conditionId === c1.conditionId)).toMatchObject({ mean: 0.5, min: 0, max: 1, n: 2 });
    expect(sums.find((x) => x.scorerId === 'judge' && x.conditionId === c1.conditionId)).toMatchObject({ mean: 0.7, n: 2 });
    expect(sums.find((x) => x.scorerId === 'judge' && x.conditionId === c2.conditionId)).toBeUndefined();
    s.clearScores(c1.id);
    expect(s.scores(p.id)).toHaveLength(2);
  });
});

describe('an experiment read elsewhere', () => {
  function made() {
    const db = new DatabaseSync(':memory:');
    const s = ExperimentStore.fromHandle(db);
    const e = s.create({ name: 'Old or new finder', question: 'Does the new version find different jobs?', task: { agentId: 'finder' }, inputs: { TOPIC: 'staff jobs' }, factors: [FACTORS[0]], repeats: 2, scorers: [{ kind: 'found', name: 'Has A', items: ['role a'] }] });
    const other = s.create({ name: 'Old or new digest', task: { agentId: 'digest' }, factors: [] });
    return { db, s, e, other };
  }
  const run = (s: ExperimentStore, e: { id: string }) => {
    const p = s.startPass(e.id);
    const cells = s.cells(p.id);
    for (const c of cells) s.updateCell(c.id, { status: 'done', items: c.conditionId === 'old' ? [item('Role A', 'https://x.example/a'), item('Role B')] : [item('Role A', 'https://x.example/a'), item('Role C'), item('Role D')] });
    s.updateCell(cells[3].id, { status: 'invalid', error: 'Its output has no list.' });
    return p;
  };

  it('gives a page its finding, figures and tables from the stored runs, and says so before any', () => {
    const { s, e } = made();
    const none = experimentPageData(e, []);
    expect(none).toMatchObject({ label: 'Not run yet', runs: 'not run yet', href: '/experiments/old-or-new-finder', figures: [], items: [] });
    expect(none.headline).toContain('a pass runs finder 4 times');
    const p = run(s, e);
    const d = experimentPageData(e, s.cells(p.id), s.scores(p.id));
    expect(d.runs).toBe('3 of 4 runs');
    expect(d.headline).toMatch(/^\*\*Build changed what it produced, beyond run-to-run variation\.\*\* Changing build: 1 of 4 items were in both/);
    expect(d.rests).toBe('2 versions, 1 run of each. It holds for this ask, when it was run. 1 run couldn\'t be used and is not counted.');
    expect(d.figures[0]).toMatchObject({ value: '25%', label: 'of what they found was in both, when build changed', tone: 'ok' });
    expect(d.conditions).toEqual([
      { condition: 'Old (baseline)', runs: '2 of 2', found: '2', shared: '', s0: '100%' },
      { condition: 'New', runs: '1 of 2', found: '3', shared: '25% (1 of 4)', s0: '100%' },
    ]);
    // The ones only one version found lead; the one both found is last, with its link.
    expect(d.items.map((i) => [i.item, i.c0, i.c1])).toEqual([['Role B', 'all 2, place 2', 'not found'], ['Role C', 'not found', 'found, place 2'], ['Role D', 'not found', 'found, place 3'], ['Role A', 'all 2, place 1', 'found, place 1']]);
    expect(d.items[3].link).toBe('https://x.example/a');
    expect(experimentPageData(e, s.cells(p.id), [], { running: true }).label).toBe('So far');
    expect(missingExperimentData('gone').headline).toContain('no longer there');
    // A notebook page made for it: a column for each version and scorer, and it checks out as a notebook layout.
    const layout = experimentLayout(e);
    const table = (id: string) => (layout.components.find((c) => c.id === id) as unknown as { columns: Array<{ key: string; label: string }> }).columns;
    expect(table('conditions').map((c) => c.label)).toEqual(['Version', 'Runs', 'Items found', 'In both', 'Has A']);
    expect(table('items').map((c) => c.label)).toEqual(['Item', 'Old', 'New']);
    expect(checkNotebookLayout(layout.components)).toMatchObject({ ok: true });
    expect(layout.components.some((c) => c.id === 'changes')).toBe(false);
    const nbs = NotebookStore.fromHandle((s as unknown as { db: DatabaseSync }).db);
    const nb = nbs.create({ title: 'Shown', statement: '', params: [], criteria: [] });
    nbs.setLayout(nb.id, layout, 'experiment');
    nbs.setExperiment(nb.id, e.id);
    expect(nbs.forExperiment(e.id)).toMatchObject({ id: nb.id, experimentId: e.id });
  });

  it('reads out as text or JSON, whole or a part, and finds one by id, link, name or words', () => {
    const { s, e, other } = made();
    expect(findExperiment(s, `http://127.0.0.1:3000/experiments/${e.id}?flash=x`)).toMatchObject({ experiment: { id: e.id } });
    expect(findExperiment(s, 'old or new DIGEST')).toMatchObject({ experiment: { id: other.id } });
    expect((findExperiment(s, 'old or new') as { matches: unknown[] }).matches).toHaveLength(2);
    expect(findExperiment(s, 'nothing like it')).toBeUndefined();
    const before = experimentReadoutText(readExperiment(s, e.id)!);
    expect(before).toContain('Nothing has run yet, so it has found nothing.');
    expect(before).toContain('Runs the whole of finder, 2 times for each version, and compares what each run\'s output lists.');
    expect(before).toContain('The ask, the same for every run: TOPIC = "staff jobs".');
    expect(before).toContain('- New: agent version 4; runs on codex model-b');
    run(s, e);
    const read = readExperiment(s, e.id)!;
    const text = experimentReadoutText(read);
    expect(text).toContain('Build changed what it produced, beyond run-to-run variation.');
    expect(text).toContain('Repeat them as they are; do not restate them differently or apply them to another ask.');
    expect(text).toContain('- New: 1 of 2 runs; listed 3 items on average; 25% (1 of 4) in both with the baseline; Has A 100%');
    expect(text).toContain('- Role B: Old: all 2, place 2; New: not found');
    expect(text).toContain('- New, run 2: invalid: Its output has no list.');
    expect(experimentReadoutText(read, 'finding')).not.toContain('## How it is set up');
    const json = experimentReadoutJson(read) as { setup: { ask: unknown; runs: string }; versions: Array<Record<string, string>>; items: Array<{ item: string; found: Record<string, string> }>; runs: { usable: number; unusable: number } };
    expect(json.setup).toMatchObject({ runs: 'finder', ask: { TOPIC: 'staff jobs' } });
    expect(json.versions[1]).toMatchObject({ version: 'New', itemsFound: '3', inBothWithBaseline: '25% (1 of 4)', 'Has A': '100%' });
    expect(json.items[0]).toEqual({ item: 'Role B', found: { Old: 'all 2, place 2', New: 'not found' } });
    expect(json.runs).toMatchObject({ usable: 3, unusable: 1 });
  });

  it('is a built-in tool: lists, reads, says when there is none, and names its policy resource', async () => {
    const { db, e, other } = made();
    const tool = getBuiltinTool('experiment-read')!;
    const ctx = { notebooks: NotebookStore.fromHandle(db) };
    const listed = await tool.execute({}, ctx);
    expect(listed.result).toContain(`${e.id} — Old or new finder (not run yet): Does the new version find different jobs?`);
    expect(listed.experiments).toHaveLength(2);
    expect((await tool.execute({ experiment: e.id, part: 'setup' }, ctx)).result).toContain('## How it is set up');
    expect(JSON.parse(String((await tool.execute({ experiment: `/experiments/${other.id}`, format: 'json' }, ctx)).result))).toMatchObject({ id: other.id, stands: 'not run yet' });
    expect(await tool.execute({ experiment: 'nope' }, ctx)).toMatchObject({ isError: true });
    expect(await tool.execute({ experiment: e.id }, {})).toMatchObject({ isError: true, result: 'Experiments are not available in this run.' });
    expect(policyResource('experiment-read', { experiment: `http://x/experiments/${e.id}` })).toBe(e.id);
  });
});
