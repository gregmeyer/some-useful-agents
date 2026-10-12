/** Notebook steps: the work in order (find, source, check, decide), each with a goal checked from the notebook alone. */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { NotebookStore, cleanSteps, stepProgress, notebookViewData, stepFunnelLabels, criterionLink } from './notebooks.js';

let dir: string;
let runs: RunStore;
afterEach(() => { try { runs?.close(); } catch { /* ignore */ } if (dir) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-nb-steps-'));
  runs = new RunStore(join(dir, 'runs.db'));
  const s = NotebookStore.fromHandle(runs.databaseHandle());
  const nb = s.create({ title: 'Comp set', statement: 'Ten peers of a planning company' });
  s.setFields(nb.id, [
    { key: 'site', label: 'Website', type: 'url', role: 'link' },
    { key: 'employees', label: 'Employees', type: 'number' },
    { key: 'founded', label: 'Founded', type: 'number' },
    { key: 'fit', label: 'Fit', type: 'number', role: 'score' },
  ]);
  s.setChecks(nb.id, ['Value to customers']);
  return { s, id: nb.id };
}

describe('notebook steps', () => {
  it('are kept in order, cleaned, and keep their status when set again', () => {
    const { s, id } = setup();
    const nb = s.setSteps(id, [
      { title: 'Find 3 companies', kind: 'find', agentId: 'account-research', target: 3.4 },
      { title: '  Source   their facts ', kind: 'source', agentId: 'Bad Id!' },
      { title: 'Nope', kind: 'dance' },
      { title: 'Check value to customers', kind: 'check' },
      { title: 'Pick the final set', kind: 'decide', target: 2 },
    ]);
    expect(nb.steps).toEqual([
      { id: 's1', title: 'Find 3 companies', kind: 'find', agentId: 'account-research', target: 3, status: 'todo', tries: 0 },
      { id: 's2', title: 'Source their facts', kind: 'source', status: 'todo', tries: 0 },
      { id: 's3', title: 'Check value to customers', kind: 'check', status: 'todo', tries: 0 },
      { id: 's4', title: 'Pick the final set', kind: 'decide', target: 2, status: 'todo', tries: 0 },
    ]);
    s.updateStep(id, 's1', { status: 'met', tries: 2, note: '3 of 3 companies' });
    const again = s.setSteps(id, nb.steps!.map((x) => ({ ...x, status: undefined, tries: undefined })));
    expect(again.steps![0]).toMatchObject({ status: 'met', tries: 2, note: '3 of 3 companies' });
    expect(s.updateStep(id, 's1', { status: 'done' }).steps![0].doneAt).toBeTruthy();
    expect(() => s.updateStep(id, 'nope', { status: 'done' })).toThrow('No step');
    expect(s.setSteps(id, []).steps).toBeUndefined();
    expect(cleanSteps(Array.from({ length: 9 }, (_, i) => ({ title: `Find ${String(i)}`, kind: 'find' })))).toHaveLength(6);
  });

  it("a source step's facts are kept as the notebook's field keys, by key or label; unknown ones are dropped", () => {
    const { s, id } = setup();
    const nb = s.setSteps(id, [
      { title: 'Source size', kind: 'source', facts: ['Employees', 'founded', 'Revenue', 'Employees'] },
      { title: 'Source nothing known', kind: 'source', facts: ['Revenue'] },
      { title: 'Find 3', kind: 'find', target: 3, facts: ['employees'] },
    ]);
    expect(nb.steps!.map((x) => x.facts)).toEqual([['employees', 'founded'], undefined, undefined]);
  });

  it('a stuck step can be stalled, a done one moved on; a new status starts clean', () => {
    const { s, id } = setup();
    s.setSteps(id, [{ title: 'Source facts', kind: 'source' }, { title: 'Pick 2', kind: 'decide', target: 2 }]);
    expect(s.updateStep(id, 's1', { status: 'stuck', stalled: true }).steps![0]).toMatchObject({ status: 'stuck', stalled: true });
    // Set again (same id and status): kept.
    expect(s.setSteps(id, [{ id: 's1', title: 'Source facts', kind: 'source' }]).steps![0].stalled).toBe(true);
    const done = s.updateStep(id, 's1', { status: 'done', movedOn: true }).steps![0];
    expect(done).toMatchObject({ status: 'done', movedOn: true });
    expect(done.stalled).toBeUndefined();
    const again = s.updateStep(id, 's1', { status: 'todo' }).steps![0];
    expect(again.movedOn).toBeUndefined();
    // Only where they mean something.
    expect(s.setSteps(id, [{ title: 'Find', kind: 'find', status: 'todo', stalled: true, movedOn: true }]).steps![0]).toEqual({ id: 's1', title: 'Find', kind: 'find', status: 'todo', tries: 0 });
  });

  it('a notebook without steps has none', () => {
    const { s, id } = setup();
    expect(s.get(id)!.steps).toBeUndefined();
  });

  it('checks each kind of goal from the notebook alone', () => {
    const { s, id } = setup();
    const add = (title: string, data: Record<string, number | string>) => s.upsertOption(id, { title, by: 'agent:account-research', data }).entry;
    const a = add('Acme Planning', { employees: 300, founded: 2012, fit: 80 });
    add('Brightline', { employees: 120, fit: 70 });
    const nb = () => s.get(id)!;
    const all = () => s.entries(id, 1000);

    expect(stepProgress(nb(), all(), { kind: 'find', target: 3, status: 'running' })).toEqual({ met: false, have: 2, want: 3, missing: ['1 more'] });
    const c = add('Cobalt Systems', { employees: 50, founded: 2019, fit: 60 });
    expect(stepProgress(nb(), all(), { kind: 'find', target: 3, status: 'running' }).met).toBe(true);

    // Source: the link and fit score aren't facts to look up.
    expect(stepProgress(nb(), all(), { kind: 'source', status: 'running' })).toEqual({ met: false, have: 5, want: 6, missing: ['Brightline — founded'] });
    // A source step that looks up only some facts counts only those.
    expect(stepProgress(nb(), all(), { kind: 'source', status: 'running', facts: ['employees'] })).toEqual({ met: true, have: 3, want: 3, missing: [] });

    // Check: every option in the running has each check; ruling one out takes it out of the running.
    s.checkOption(id, a.id, 'Value to customers', true);
    s.checkOption(id, c.id, 'value to customers', true);
    expect(stepProgress(nb(), all(), { kind: 'check', status: 'running' })).toMatchObject({ met: false, have: 2, want: 3, missing: ['Brightline — Value to customers'] });
    const b = s.findOption(id, 'Brightline')!;
    s.ruleOut(id, b.id, 'Sells to IT, not finance');
    expect(stepProgress(nb(), all(), { kind: 'check', status: 'running' }).met).toBe(true);
    expect(stepProgress(nb(), all(), { kind: 'source', status: 'running' }).met).toBe(true);

    // Decide: met only when you've confirmed it.
    expect(stepProgress(nb(), all(), { kind: 'decide', target: 2, status: 'met' })).toEqual({ met: false, have: 0, want: 2, missing: [] });
    expect(stepProgress(nb(), all(), { kind: 'decide', target: 2, status: 'done' }).met).toBe(true);

    // A check step on a notebook with no checks has checked nothing yet.
    s.setChecks(id, []);
    expect(stepProgress(nb(), all(), { kind: 'check', status: 'todo' })).toMatchObject({ met: false, have: 0, want: 2 });
  });

  it('with steps, the funnel is how far each option got through them: found, facts sourced, checked, chosen', () => {
    const { s, id } = setup();
    s.setSteps(id, [
      { title: 'Find 4 companies', kind: 'find', target: 4 },
      { title: 'Source size', kind: 'source', facts: ['employees', 'founded'] },
      { title: 'Check value', kind: 'check' },
      { title: 'Pick the final 2', kind: 'decide', target: 2 },
    ]);
    const add = (title: string, data: Record<string, number | string>) => s.upsertOption(id, { title, by: 'agent:research', data: { site: `https://${title.toLowerCase()}.example`, ...data } }).entry;
    const initech = add('Initech', {});
    const globex = add('Globex', { employees: 1200 });
    const hooli = add('Hooli', { employees: 1500, founded: 2017 });
    const acme = add('Acme', { employees: 3000, founded: 2016 });
    const umbrella = add('Umbrella', { employees: 2000, founded: 2018 });
    s.checkOption(id, acme.id, 'Value to customers', true);
    s.checkOption(id, umbrella.id, 'Value to customers', true);
    s.ruleOut(id, globex.id, 'too small');
    s.ruleOut(id, umbrella.id, 'not a peer');
    // Moved by hand to a stage: with steps, that's not what the funnel counts.
    s.setStages(id, ['Found', 'Shortlist']);
    s.moveOption(id, initech.id, 'Shortlist');
    const v = notebookViewData(s.get(id)!, s.entries(id)).notebook;
    expect(v.funnel.map((f) => `${f.stage}:${f.reached}/${f.here}/${f.ruledOut}`)).toEqual(['Found:5/1/1', 'Facts sourced:3/1/0', 'Checked:2/1/1', 'Chosen:0/0/0']);
    expect(v.funnel[2].reasons).toEqual([{ reason: 'not a peer', count: 1 }]);

    const decided = s.decide(id, '', 'you', [acme.id, hooli.id]);
    expect(decided.decision).toBe('Chose Acme and Hooli.');
    expect(decided.steps!.find((x) => x.kind === 'decide')).toMatchObject({ status: 'done', note: '2 chosen' });
    const after = notebookViewData(s.get(id)!, s.entries(id)).notebook;
    // Hooli was chosen without being checked: it counts as chosen (what you picked), and not as checked.
    expect(after.funnel.map((f) => `${f.stage}:${f.reached}`)).toEqual(['Found:5', 'Facts sourced:3', 'Checked:2', 'Chosen:2']);
    expect(after.options.filter((o) => o.chosen).map((o) => o.title).sort()).toEqual(['Acme', 'Hooli']);
    expect(stepProgress(s.get(id)!, s.entries(id), decided.steps![3])).toMatchObject({ met: true, have: 2, want: 2 });
    expect(stepFunnelLabels([{ kind: 'find', title: 'Find' }, { kind: 'check', title: 'Check price' }, { kind: 'check', title: 'Check reviews' }])).toEqual(['Found', 'Check price', 'Check reviews']);
  });

  it('a decision needs a pick or a reason; picks must be options still in the running', () => {
    const { s, id } = setup();
    const a = s.upsertOption(id, { title: 'Initech', by: 'you', data: { site: 'https://initech.example' } }).entry;
    const b = s.upsertOption(id, { title: 'Globex', by: 'you', data: { site: 'https://globex.example' } }).entry;
    s.ruleOut(id, b.id, 'too small');
    expect(() => s.decide(id, '  ', 'you', [])).toThrow('Pick what you chose');
    expect(() => s.decide(id, '', 'you', [b.id])).toThrow('was ruled out');
    expect(() => s.decide(id, '', 'you', ['nope'])).toThrow("isn't in this notebook");
    expect(s.get(id)!.status).toBe('active');
    expect(s.decide(id, 'Best fit by far.', 'you', [a.id, a.id]).decision).toBe('Chose Initech. Best fit by far.');
    expect(s.decide(id, 'Stopped looking.').decision).toBe('Stopped looking.');
    // A decision with no picks leaves the earlier picks alone.
    expect(s.entries(id).find((e) => e.id === a.id)?.chosenAt).toBeTruthy();
  });

  it('done-whens that repeat the work tick themselves; ones you set by hand are left alone', () => {
    const { s, id } = setup();
    s.setChecks(id, ['Clean title (VIN)', 'Water-resistant material']);
    s.setCriteria(id, ['At least two companies that fit', 'Employees and founding year sourced for each', 'clean title', 'Water-resistant material', 'A final comp set recorded', 'We decide whether to buy', 'It sounds different']);
    const nb = s.get(id)!;
    expect(nb.criteria.map((c) => criterionLink(nb, c.text))).toEqual([
      { kind: 'count', n: 2 }, { kind: 'source' }, { kind: 'check', check: 'Clean title (VIN)' }, { kind: 'check', check: 'Water-resistant material' },
      { kind: 'decide' }, { kind: 'decide' }, undefined,
    ]);
    s.setSteps(id, [{ title: 'Find 2', kind: 'find', target: 2 }, { title: 'Source size', kind: 'source', facts: ['employees', 'founded'] }, { title: 'Pick 1', kind: 'decide', target: 1 }]);
    const a = s.upsertOption(id, { title: 'Acme', by: 'you', data: { site: 'https://acme.example', employees: 1200 } }).entry;
    expect(s.autoMeetCriteria(id).ticked).toEqual([]);
    s.upsertOption(id, { title: 'Hooli', by: 'you', data: { site: 'https://hooli.example', employees: 1500, founded: 2017 } });
    expect(s.autoMeetCriteria(id).ticked).toEqual(['At least two companies that fit']);
    // You unticked the decision one: deciding leaves it.
    s.markCriterion(id, 5, false);
    // Moving on from a source step short of its goal doesn't count as sourced.
    s.updateStep(id, 's2', { status: 'done', movedOn: true });
    expect(s.get(id)!.criteria[1].met).toBe(false);
    s.checkOption(id, a.id, 'Clean title (VIN)', true);
    const done = s.decide(id, '', 'you', [a.id]);
    expect(done.criteria.map((c) => c.met)).toEqual([true, false, true, false, true, false, false]);
  });

  it('a narrow step keeps some, rules out the rest with why, and leaves the notebook open', () => {
    const { s, id } = setup();
    s.setSteps(id, [{ title: 'Find 3', kind: 'find', target: 3 }, { title: 'Keep a shortlist', kind: 'narrow', target: 2 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const add = (title: string) => s.upsertOption(id, { title, by: 'you', data: { site: `https://${title.toLowerCase()}.example` } }).entry;
    const a = add('Acme'); const b = add('Hooli'); const c = add('Globex');
    expect(stepProgress(s.get(id)!, s.entries(id), s.get(id)!.steps![1])).toMatchObject({ met: false, have: 0, want: 2 });
    expect(() => s.narrow(id, [])).toThrow('Pick at least one');
    s.ruleOut(id, c.id, 'too small');
    expect(() => s.narrow(id, [a.id, c.id])).toThrow("isn't in the running");
    const nb = s.narrow(id, [a.id], '');
    expect(nb.status).toBe('active');
    expect(nb.steps![1]).toMatchObject({ status: 'done', note: 'kept 1 of 2' });
    expect(s.entries(id).find((e) => e.id === b.id)?.ruledOut).toMatchObject({ reason: 'Not kept at "Keep a shortlist"', by: 'you' });
    expect(s.entries(id).find((e) => e.kind === 'decision')?.title).toBe('Kept 1, ruled out 1');
    const v = notebookViewData(s.get(id)!, s.entries(id)).notebook;
    expect(v.funnel.map((f) => `${f.stage}:${f.reached}`)).toEqual(['Found:3', 'Kept:1', 'Chosen:0']);
    // Your own reason is kept as theirs.
    s.reinstate(id, b.id);
    s.updateStep(id, 's2', { status: 'todo' });
    s.narrow(id, [b.id], 'over budget');
    expect(s.entries(id).find((e) => e.id === a.id)?.ruledOut?.reason).toBe('over budget');
  });

  it('a source or check step on the top N counts only those', () => {
    const { s, id } = setup();
    const nb = s.setSteps(id, [{ title: 'Source size', kind: 'source', facts: ['employees'], top: 2.4 }, { title: 'Find 3', kind: 'find', top: 2 }]);
    expect(nb.steps!.map((x) => x.top)).toEqual([2, undefined]);
    for (const [title, fit, employees] of [['Acme', 90, 1200], ['Hooli', 80, undefined], ['Globex', 70, undefined]] as const) {
      s.upsertOption(id, { title, by: 'you', data: { site: `https://${title.toLowerCase()}.example`, fit, ...(employees ? { employees } : {}) } });
    }
    expect(stepProgress(s.get(id)!, s.entries(id), { kind: 'source', facts: ['employees'], status: 'todo', top: 2 })).toMatchObject({ met: false, have: 1, want: 2, missing: ['Hooli — employees'] });
    expect(stepProgress(s.get(id)!, s.entries(id), { kind: 'source', facts: ['employees'], status: 'todo' })).toMatchObject({ have: 1, want: 3 });
  });
});

