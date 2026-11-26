/**
 * Templates from skills (lib/template-actions.ts): the template-drafter turns
 * skills and a job into a template (changing nothing), checked in code; the
 * template-save card saves it; a notebook from it has the steps, the gates
 * as checks and the weighted criteria, and its scorer gets the anchors.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStore, InboxStore, NotebookStore, RunStore, notebookViewData, parseAgent, type InboxActionMeta } from '@some-useful-agents/core';
import { executeTemplateSave, readTemplateReply, startTemplateDraft, TEMPLATE_SAVE } from '../lib/template-actions.js';
import { BackgroundTasks } from '../lib/background.js';
import { keep, pipelineInputs } from '../lib/notebook-pipeline.js';
import { parseActionMeta } from './inbox-shared.js';
import { parseProposedActions } from './inbox-plan.js';
import { startNotebookFrom } from './inbox-engine.js';
import { renderInboxDetailFragment } from '../views/inbox-detail.js';

let dir: string;
let agentStore: AgentStore;
let inboxStore: InboxStore;
let runStore: RunStore;
type Ctx = ReturnType<typeof import('../context.js').getContext>;

function setup(drafter?: (inputs: Record<string, string>) => Promise<string | undefined>): Ctx {
  dir = mkdtempSync(join(tmpdir(), 'sua-inbox-templates-'));
  const db = join(dir, 'runs.db');
  agentStore = new AgentStore(db);
  inboxStore = new InboxStore(db);
  runStore = new RunStore(db);
  return { agentStore, inboxStore, runStore, background: new BackgroundTasks(), ...(drafter ? { templateDrafterRun: drafter } : {}) } as never as Ctx;
}
afterEach(() => {
  for (const s of [agentStore, inboxStore, runStore]) { try { s.close(); } catch { /* ignore */ } }
  if (dir) rmSync(dir, { recursive: true, force: true });
});
const notebooks = () => NotebookStore.fromHandle(runStore.databaseHandle());

const anchors = (what: string) => [`${what}: unsuitable`, 'major gaps', 'partial fit', 'meets the need', 'exceeds it in a way that matters'];
const crit = (key: string, label: string, weight: number, axis: string) => ({ key, label, type: 'number', weight, anchors: anchors(label), axis });
const SETUP = (weights = [40, 30, 30]) => ({
  statement: 'When the team outgrows spreadsheets, sales needs a CRM so that deals stop slipping, within a small budget.',
  params: ['5 users'],
  criteria: ['Each option scored on every criterion', 'A recommendation written', 'A decision recorded'],
  asks: [{ label: 'Your current stack', why: 'integration', optional: true }],
  checks: ['Has a plan for 5 users under $100 a month', 'Exports all data as CSV'],
  fields: [
    { key: 'vendor', label: 'Vendor', type: 'text', role: 'org' },
    { key: 'website', label: 'Website', type: 'url', role: 'link' },
    crit('job_fit', 'Job fit', weights[0], 'suitability'),
    crit('integration', 'Integration', weights[1], 'feasibility'),
    crit('cost', 'Cost', weights[2], 'feasibility'),
  ],
  stages: ['Found', 'Checked', 'Scored', 'Chosen'],
  steps: [
    { title: 'Find 5 CRMs', kind: 'find', target: 5 },
    { title: 'Check the gates', kind: 'check' },
    { title: 'Score each criterion', kind: 'source', agent: 'software-scorer', facts: ['job_fit', 'integration', 'cost'] },
    { title: 'Write up the field', kind: 'write', shape: 'writeup' },
    { title: 'Pick one', kind: 'decide', target: 1 },
  ],
  layout: 'comparison',
});
const reply = (setup: unknown, name = 'Pick a CRM for a small sales team') => `<template name="${name}" description="Compares CRMs for a small sales team on weighted criteria.">\n${JSON.stringify(setup)}\n</template>\n<why>The workflow and rubric; procurement mode is left out.</why>`;

async function draft(ctx: Ctx, inputs: Record<string, string>) {
  const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'Build a comparison template for picking a CRM' });
  const r = startTemplateDraft(ctx, msg.id, { kind: 'action', status: 'running', agentId: 'template-draft', effect: 'read', inputs });
  await (ctx as unknown as { background: BackgroundTasks }).background.drain(5000);
  const responses = inboxStore.listResponses(msg.id);
  const card = responses.map((x) => parseActionMeta(x)).find((m): m is InboxActionMeta => !!m && m.agentId === TEMPLATE_SAVE);
  const said = responses.filter((x) => x.role === 'triage').map((x) => x.body).join('\n');
  return { r, card, said, msg };
}

describe("the drafter's reply", () => {
  it('reads the template block, and a step\'s "agent" as its agentId', () => {
    const got = readTemplateReply(reply(SETUP()));
    expect(got).toMatchObject({ name: 'Pick a CRM for a small sales team', why: 'The workflow and rubric; procurement mode is left out.' });
    expect((got as { setup: { steps: Array<{ agentId?: string }> } }).setup.steps[2].agentId).toBe('software-scorer');
    expect(readTemplateReply('no block')).toEqual({ problem: expect.stringContaining('no <template') });
    expect(readTemplateReply('<template name="x" description="d">{not json</template>')).toEqual({ problem: expect.stringContaining('valid JSON') });
  });
});

describe('template-draft → the template-save card', () => {
  it('drafts with the skills, the job, the step agents and the pages there are; nothing is saved', async () => {
    let seen: Record<string, string> = {};
    const ctx = setup(async (inputs) => { seen = inputs; return reply(SETUP()); });
    const { r, card } = await draft(ctx, { ASK: 'pick a CRM for a 5-person sales team', SKILLS: 'evaluate-software,software-rubric', MODE: 'quick' });
    expect(r).toMatchObject({ status: 'completed', summary: 'Drafting the template…' });
    expect(seen).toMatchObject({ SKILLS: 'evaluate-software, software-rubric', JOB: 'pick a CRM for a 5-person sales team', MODE: 'quick' });
    expect(seen.AGENTS).toMatch(/^software-scorer: /);
    expect(seen.LAYOUTS).toContain('comparison: ');
    expect(seen.CONVERSATION).toContain('comparison template');
    expect(card).toMatchObject({ status: 'proposed', ctaLabel: 'Save the template', inputs: { NAME: 'Pick a CRM for a small sales team' } });
    expect(JSON.parse(card!.inputs.SETUP).fields.find((f: { key: string }) => f.key === 'job_fit')).toMatchObject({ weight: 40, axis: 'suitability' });
    expect(notebooks().listTemplates()).toHaveLength(0);
  });

  it('tries once more told what was wrong, and says so when neither can be used', async () => {
    const replies = [reply(SETUP([40, 30, 20])), reply(SETUP())];
    let fix = '';
    const ctx = setup(async (inputs) => { fix = inputs.FIX; return replies.shift(); });
    const { card } = await draft(ctx, { ASK: 'pick a CRM', SKILLS: 'evaluate-software' });
    expect(fix).toContain("weights add to 90, not 100");
    expect(card).toBeDefined();
    const ctx2 = setup(async () => reply({ ...SETUP(), steps: [{ title: 'Score', kind: 'source', agentId: 'no-such-agent' }] }));
    const { card: none, said } = await draft(ctx2, { ASK: 'pick a CRM', SKILLS: 'evaluate-software' });
    expect(none).toBeUndefined();
    expect(said).toContain("I couldn't draft that template");
    expect(said).toContain("needs no-such-agent, which isn't installed");
  });

  it("refuses a skill that doesn't exist, before drafting", () => {
    const ctx = setup(async () => reply(SETUP()));
    const msg = inboxStore.add({ priority: 'medium', source: 'manual', title: 'chat', body: 'x' });
    const r = startTemplateDraft(ctx, msg.id, { kind: 'action', status: 'running', agentId: 'template-draft', effect: 'read', inputs: { ASK: 'pick a CRM', SKILLS: 'evaluate-software, made-up' } });
    expect(r).toMatchObject({ status: 'failed', refusalReason: expect.stringContaining("no skill called made-up") });
  });

  it('shows the gates, each criterion with its weight and side, and its page', async () => {
    const ctx = setup(async () => reply(SETUP()));
    const { msg } = await draft(ctx, { ASK: 'pick a CRM', SKILLS: 'evaluate-software,software-rubric' });
    const html = String(renderInboxDetailFragment({ message: inboxStore.get(msg.id)!, responses: inboxStore.listResponses(msg.id) } as never));
    expect(html).toContain('Save the template <span class="mono">Pick a CRM for a small sales team</span>');
    expect(html).toContain('Has a plan for 5 users under $100 a month');
    expect(html).toMatch(/Scored 0–4 on<\/span> 3 criteria/);
    expect(html).toMatch(/Job fit<\/span><span><span class="mono">40<\/span> · suitability/);
    expect(html).toContain('3. Score each criterion (software-scorer)');
    expect(html).toContain('Comparison');
    expect(html).toContain('never 0');
  });
});

describe('the template-save card', () => {
  it('saves it; a notebook from it has the steps, gates, criteria and page, and the scorer gets the anchors', async () => {
    const ctx = setup(async () => reply(SETUP()));
    const { card } = await draft(ctx, { ASK: 'pick a CRM', SKILLS: 'evaluate-software,software-rubric' });
    const r = executeTemplateSave(ctx, card!);
    expect(r).toMatchObject({ status: 'completed', summary: expect.stringContaining('Saved the template **Pick a CRM for a small sales team**') });
    const t = notebooks().listTemplates()[0];
    expect(t).toMatchObject({ name: 'Pick a CRM for a small sales team', description: 'Compares CRMs for a small sales team on weighted criteria.' });
    expect(agentStore.getAgent('software-scorer')).toBeDefined();
    const made = startNotebookFrom(ctx, { TEMPLATE: t.id, TITLE: 'Pick a CRM for our team' });
    if ('error' in made) throw new Error(made.error);
    const nb = made.notebook;
    expect(nb.steps?.map((s) => [s.kind, s.agentId ?? ''])).toEqual([['find', ''], ['check', ''], ['source', 'software-scorer'], ['write', ''], ['decide', '']]);
    expect(nb.checks).toEqual(['Has a plan for 5 users under $100 a month', 'Exports all data as CSV']);
    expect(nb.layout?.preset).toBe('comparison');
    const fields = JSON.parse(pipelineInputs(agentStore.getAgent('software-scorer')!, nb).FIELDS) as Array<{ key: string; weight?: number; anchors?: string[]; axis?: string }>;
    expect(fields.find((f) => f.key === 'cost')).toMatchObject({ weight: 30, axis: 'feasibility', anchors: anchors('Cost') });
    expect(fields.find((f) => f.key === 'vendor')).not.toHaveProperty('weight');
    // The scorer's own block is filed as is: a 0 stays 0, with its quote and confidence, and the scorecard counts it.
    const store = notebooks();
    const opt = store.addEntry(nb.id, { kind: 'option', title: 'Acme CRM', body: 'A CRM.', by: 'you' });
    const scored = { facts: [{ id: opt.id, data: { job_fit: { value: 0, source: 'https://acme.example/f', quote: 'No pipeline view on any plan', checked: true, confidence: 'medium' }, cost: { value: 4, source: 'https://acme.example/p', quote: 'The Starter plan costs $12', checked: true, confidence: 'high' } } }], summary: 'Scored 2.' };
    const out = await keep(ctx, store, store.get(nb.id)!, 'software-scorer', 'run-1', `Scored.\n<notebook>${JSON.stringify(scored)}</notebook>`);
    expect(out).toMatchObject({ direct: true, factsSet: 1 });
    const after = store.entries(nb.id, 100).find((e) => e.id === opt.id)!;
    expect(after.data).toMatchObject({ job_fit: 0, cost: 4 });
    expect(after.factMeta?.job_fit).toMatchObject({ source: 'https://acme.example/f', confidence: 'medium' });
    const row = notebookViewData(store.get(nb.id)!, store.entries(nb.id, 100)).notebook.scorecard?.rows.find((x) => x.id === opt.id);
    expect(row).toMatchObject({ lower: 30, upper: 60, coverage: 70 });
  });

  it("a template's asks they already answered (GIVEN) are kept as given; the rest stay asked", async () => {
    const ctx = setup(async () => reply({ ...SETUP(), asks: [{ label: 'Your current stack', optional: false }, { label: 'Budget per user', optional: false }, { label: 'Deadline', optional: true }] }));
    const { card } = await draft(ctx, { ASK: 'pick a CRM', SKILLS: 'evaluate-software' });
    executeTemplateSave(ctx, card!);
    const t = notebooks().listTemplates()[0];
    const { accepted } = parseProposedActions([{ type: 'notebook-create', inputs: { TEMPLATE: t.id, TITLE: 'Pick a CRM', GIVEN: { 'your current stack': 'Google Workspace for email and calendar', 'Budget per user': '$50', 'Not an ask': 'ignored' } } }], [], []);
    const made = startNotebookFrom(ctx, accepted[0].inputs);
    if ('error' in made) throw new Error(made.error);
    const given = notebooks().get(made.notebook.id)!.given!;
    expect(given.map((g) => [g.label, g.state])).toEqual([['Your current stack', 'given'], ['Budget per user', 'given'], ['Deadline', 'missing']]);
    expect(given[1].text).toBe('Budget per user: $50');
    // Said in a line: already its own short form, so the page doesn't ask sua to read it.
    expect(given[1].read).toMatchObject({ summary: '$50', facts: [{ label: 'Budget per user', value: '$50', byYou: true }] });
  });

  it('a change keeps the name and replaces the template', async () => {
    const ctx = setup(async () => reply(SETUP()));
    const first = await draft(ctx, { ASK: 'pick a CRM', SKILLS: 'evaluate-software' });
    executeTemplateSave(ctx, first.card!);
    let current = '';
    const ctx2 = { ...ctx, templateDrafterRun: async (inputs: Record<string, string>) => { current = inputs.CURRENT; return reply(SETUP([30, 40, 30]), 'Something else'); } } as Ctx;
    const { card } = await draft(ctx2, { ASK: 'make integration 40', SKILLS: 'evaluate-software', NAME: 'Pick a CRM for a small sales team' });
    expect(current).toMatch(/^name: Pick a CRM for a small sales team\n\{/);
    expect(card).toMatchObject({ ctaLabel: 'Save the change', inputs: { NAME: 'Pick a CRM for a small sales team', REPLACES: 'pick-a-crm-for-a-small-sales-team' } });
    executeTemplateSave(ctx2, card!);
    expect(notebooks().listTemplates()).toHaveLength(1);
    expect(notebooks().listTemplates()[0].setup.fields.find((f) => f.key === 'integration')?.weight).toBe(40);
  });
});

describe("sua's plan", () => {
  it('accepts template-draft (read) with the job and skills; refuses one without them', () => {
    const { accepted, rejected } = parseProposedActions([
      { type: 'template-draft', inputs: { ASK: 'pick a CRM for a 5-person team', SKILLS: ['evaluate-software', 'software-rubric'], MODE: 'quick' } },
      { type: 'template-draft', inputs: { ASK: 'pick a CRM' } },
    ], [], []);
    expect(accepted.map((a) => [a.agentId, a.effect, a.ctaLabel])).toEqual([['template-draft', 'read', 'Draft it']]);
    expect(accepted[0].inputs).toEqual({ ASK: 'pick a CRM for a 5-person team', SKILLS: 'evaluate-software,software-rubric', MODE: 'quick' });
    expect(rejected[0].reason).toContain('template-draft needs inputs.ASK');
  });
});

describe('the shipped agents', () => {
  it('the drafter takes its skills from SKILLS; the scorer uses software-rubric', async () => {
    const { readExampleYaml } = await import('@some-useful-agents/core');
    const drafter = parseAgent(readExampleYaml('template-drafter', 'agents/examples')!);
    expect(drafter.skillsFromInput).toBe('SKILLS');
    const scorer = parseAgent(readExampleYaml('software-scorer', 'agents/examples')!);
    expect(scorer.skills).toEqual(['software-rubric']);
    expect(scorer.nodes.map((n) => n.id)).toEqual(['prep', 'web', 'score', 'finish']);
  });
});
