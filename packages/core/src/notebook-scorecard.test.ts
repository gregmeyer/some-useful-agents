import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scorecard, scoreOf } from './notebook-scorecard.js';
import { NotebookStore, cleanFields, cleanTemplateSetup, notebookViewData, type NotebookField } from './notebooks.js';

const anchors = ['unsuitable', 'major gaps', 'partial fit', 'meets need', 'exceeds need'];
const crit = (key: string, weight: number, axis: 'suitability' | 'feasibility'): NotebookField => ({ key, label: key.replace(/_/g, ' '), type: 'number', weight, axis, anchors });
// Job fit 50 (suitability), integration 30 and cost 20 (feasibility).
const fields = [crit('job_fit', 50, 'suitability'), crit('integration', 30, 'feasibility'), crit('cost', 20, 'feasibility')];
const gates = ['Runs on our SSO'];

describe('the scorecard (evaluate-software: unknown is null, never zero)', () => {
  it('works out bounds and coverage by hand', () => {
    const card = scorecard(fields, gates, [{ id: 'a', title: 'A', data: { job_fit: 3, integration: 2 }, checked: gates }]);
    const a = card.rows[0];
    // 50×3/4 + 30×2/4 = 37.5 + 15 = 52.5; cost (20) unknown.
    expect(a).toMatchObject({ lower: 52.5, upper: 72.5, coverage: 80, status: 'ranked', rank: 1, scores: [3, 2, null] });
    expect(card.leader).toBe('a');
  });

  it('a 0 is a score; a missing or out-of-range one is unknown', () => {
    expect(scoreOf(0)).toBe(0);
    expect(scoreOf('0')).toBe(0);
    expect(scoreOf(undefined)).toBeNull();
    expect(scoreOf('')).toBeNull();
    expect(scoreOf(5)).toBeNull();
    const zero = scorecard(fields, [], [{ id: 'z', title: 'Z', data: { job_fit: 0, integration: 0, cost: 0 } }]).rows[0];
    expect(zero).toMatchObject({ lower: 0, upper: 0, coverage: 100 });
  });

  it('a failed gate disqualifies; an unknown gate or thin coverage leaves it provisional', () => {
    const card = scorecard(fields, gates, [
      { id: 'out', title: 'Out', data: { job_fit: 4, integration: 4, cost: 4 }, failedChecks: { 'Runs on our SSO': 'no SAML' } },
      { id: 'maybe', title: 'Maybe', data: { job_fit: 4, integration: 4, cost: 4 } },
      { id: 'thin', title: 'Thin', data: { job_fit: 2 }, checked: gates },
    ]);
    const by = Object.fromEntries(card.rows.map((r) => [r.id, r]));
    expect(by.out).toMatchObject({ status: 'disqualified', why: 'fails: Runs on our SSO' });
    expect(by.out.rank).toBeUndefined();
    expect(by.maybe).toMatchObject({ status: 'provisional', rank: 1, why: '1 gate unknown' });
    expect(by.thin).toMatchObject({ status: 'provisional', why: '50% known' });
    // First is provisional: no definitive leader.
    expect(card.leader).toBeUndefined();
  });

  it('names weights that would put another option first', () => {
    const card = scorecard(fields, [], [
      { id: 'fit', title: 'Fits', data: { job_fit: 4, integration: 1, cost: 1 } },
      { id: 'easy', title: 'Easy', data: { job_fit: 2, integration: 4, cost: 4 } },
    ]);
    // Fits: 50 + 7.5 + 5 = 62.5; Easy: 25 + 30 + 20 = 75. Easy leads, and equal weights keep it first.
    expect(card.leader).toBe('easy');
    const equal = card.reversals.find((r) => r.weights === 'Equal weights');
    expect(equal).toBeUndefined();
    const flip = scorecard([crit('job_fit', 60, 'suitability'), crit('integration', 40, 'feasibility')], [], [
      { id: 'fit', title: 'Fits', data: { job_fit: 4, integration: 0 } },
      { id: 'easy', title: 'Easy', data: { job_fit: 1, integration: 4 } },
    ]);
    // Fits 60 vs Easy 15+40=55: Fits leads; with integration at ×1.5 (60 vs 15+60=75, of 120) Easy does.
    expect(flip.leader).toBe('fit');
    expect(flip.reversals).toContainEqual({ weights: 'integration at ×1.5', leader: 'easy', was: 'fit' });
  });

  it('places a point on the 2x2 only when enough of each axis is known', () => {
    const card = scorecard(fields, [], [
      { id: 'both', title: 'Both', data: { job_fit: 2, integration: 4, cost: 2 } },
      { id: 'half', title: 'Half', data: { job_fit: 4, cost: 4 } },
    ]);
    const by = Object.fromEntries(card.rows.map((r) => [r.id, r]));
    expect(by.both).toMatchObject({ suitability: 50, feasibility: 80 });
    // Feasibility: only cost (20 of 50) known — under half, so no coordinate.
    expect(by.half.suitability).toBe(100);
    expect(by.half.feasibility).toBeUndefined();
  });
});

describe('weighted criteria in a notebook', () => {
  it('fields keep their weight, anchors and axis; a weight only on a number', () => {
    const [f, t] = cleanFields([{ ...crit('job_fit', 25, 'suitability') }, { key: 'notes', label: 'Notes', type: 'text', weight: 10 }]);
    expect(f).toMatchObject({ weight: 25, axis: 'suitability', anchors, better: 'higher' });
    expect(t.weight).toBeUndefined();
  });

  it("a notebook's page data carries the scorecard and each option's 2x2 place", () => {
    const s = new NotebookStore(join(mkdtempSync(join(tmpdir(), 'sua-score-')), 'runs.db'));
    const nb = s.create({ title: 'Pick a CRM', statement: 'For a 5-person sales team' });
    s.setFields(nb.id, fields);
    s.setChecks(nb.id, gates);
    s.upsertOption(nb.id, { title: 'CRM A', by: 'x', data: { job_fit: 3, integration: { value: 2, source: 'https://a.example/docs', confidence: 'medium' } } as never });
    const data = notebookViewData(s.get(nb.id)!, s.entries(nb.id));
    expect(data.notebook.scorecard?.rows[0]).toMatchObject({ title: 'CRM A', lower: 52.5, status: 'provisional' });
    expect(data.notebook.options[0]).toMatchObject({ suitability: 75 });
    expect(data.notebook.options[0].factMeta?.integration).toMatchObject({ source: 'https://a.example/docs', confidence: 'medium' });
  });
});

describe('a template drafted from scratch', () => {
  const setup = {
    statement: 'When a deal closes, the sales lead needs to log it so that forecasts are right, within $50/seat.',
    checks: gates, fields,
    steps: [{ title: 'Find 5 CRMs', kind: 'find', target: 5 }, { title: 'Check the gates', kind: 'check' }, { title: 'Score them', kind: 'source', agentId: 'software-scorer' }, { title: 'Write it up', kind: 'write', shape: 'writeup' }, { title: 'Pick one', kind: 'decide', target: 1 }],
    asks: [{ label: 'Your current stack' }],
  };

  it('is cleaned, and says what is wrong', () => {
    expect(cleanTemplateSetup(setup).problems).toEqual([]);
    expect(cleanTemplateSetup({ ...setup, fields: [crit('job_fit', 50, 'suitability')] }).problems).toContain("The criteria's weights add to 50, not 100.");
    expect(cleanTemplateSetup({ ...setup, fields: [{ ...crit('job_fit', 100, 'suitability'), anchors: ['x'] }] }).problems).toContain('"job fit" needs what 0, 1, 2, 3 and 4 mean.');
    expect(cleanTemplateSetup(setup, { agentInstalled: () => false }).problems).toContain('Step "Score them" needs software-scorer, which isn\'t installed.');
    expect(cleanTemplateSetup({ ...setup, steps: [...setup.steps, ...setup.steps] }).problems).toContain('At most 6 steps (it has 10).');
  });

  it('saves without a notebook, and a notebook started from it gets its criteria', () => {
    const s = new NotebookStore(join(mkdtempSync(join(tmpdir(), 'sua-tpl-')), 'runs.db'));
    const t = s.saveTemplateSetup('Pick a CRM', setup, { agentInstalled: () => true });
    expect(t).toMatchObject({ id: 'pick-a-crm', name: 'Pick a CRM' });
    expect(t.fromNotebook).toBeUndefined();
    expect(t.setup.fields.map((f) => f.weight)).toEqual([50, 30, 20]);
    expect(t.setup.steps.map((st) => st.status)).toEqual(['todo', 'todo', 'todo', 'todo', 'todo']);
    expect(s.listTemplates().map((x) => x.id)).toContain('pick-a-crm');
    expect(() => s.saveTemplateSetup('Bad', { ...setup, fields: [crit('job_fit', 40, 'suitability')] })).toThrow(/add to 40/);
  });
});
