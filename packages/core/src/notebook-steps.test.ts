/** Notebook steps: the work in order (find, source, check, decide), each with a goal checked from the notebook alone. */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from './run-store.js';
import { NotebookStore, cleanSteps, stepProgress } from './notebooks.js';

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
    expect(stepProgress(nb(), all(), { kind: 'source', status: 'running' })).toEqual({ met: false, have: 2, want: 3, missing: ['Brightline — founded'] });

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
  });
});
