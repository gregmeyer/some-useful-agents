import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxStore, AgentStore, DashboardsStore, ExperimentStore, LocalProvider, MemorySecretsStore, NotebookStore, PacksStore, RunStore, buildLoopbackAllowlist, loadAgents } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';
import { caseFromPaste, cellInputs, installExperimentRanker, parseRanking, reconcileExperimentsOnBoot } from '../lib/experiment-runner.js';
import { factorsFromForm, nameFromQuestion, scorersFromForm } from './experiments.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3996;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let ctx: DashboardContext;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-experiments-route-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  ctx = {
    token: TOKEN, allowlist: buildLoopbackAllowlist(PORT), port: PORT, provider, runStore, agentStore,
    loadAgents: () => loadAgents({ directories: [agentsDir] }),
    secretsStore, secretsSession: new MemorySecretsSession({ backing: secretsStore }), tokenPath: join(dir, 'mcp-token'), retentionDays: 30, dbPath,
    secretsPath: join(dir, 'secrets.enc'), rotateToken: () => 'r'.repeat(64), packsStore, dashboardsStore, allowUntrustedShell: new Set(), activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(), inboxTriagePendingRefires: new Set(), dataDir: dir, dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
    inboxStore: InboxStore.fromHandle(runStore.databaseHandle()),
  };
  return buildDashboardApp(ctx);
}

afterEach(async () => {
  for (const s of ctx?.experimentPasses?.values() ?? []) await s.done;
  if (provider) await provider.shutdown();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { packsStore?.close(); } catch { /* ignore */ }
  try { dashboardsStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

type App = Awaited<ReturnType<typeof makeApp>>;
const post = (app: App, path: string, body: Record<string, string> = {}) => request(app).post(path).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);
const get = (app: App, path: string) => request(app).get(path).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
const idOf = (location: string) => decodeURIComponent(location).split('/experiments/')[1].split('?')[0];
const settle = async () => { for (const s of [...(ctx.experimentPasses?.values() ?? [])]) await s.done; };

const PASTE = ['Role A | Pay: $250,000 | Remote: yes', 'Role B | Pay: $210,000 | Remote: no', 'Role C | Pay: $190,000 | Remote: yes', 'Role D | Pay: $300,000 | Remote: no', 'Role E | Pay: $150,000 | Remote: yes'].join('\n');
const FORM = {
  name: 'What changes the ranking', question: 'Build or preferences?', paste: PASTE, repeats: '2',
  c1_name: 'Build', c1_kind: 'instructions', c1_v1_name: 'By pay', c1_v1_text: 'Rank by pay, highest first.', c1_v2_name: 'By letter', c1_v2_text: 'Rank by title, A first.',
  c2_name: 'Preferences', c2_kind: 'preferences', c2_v1_name: 'Remote', c2_v1_text: 'Remote only.', c2_v2_name: 'Office', c2_v2_text: 'In an office.',
};
const ranking = (ids: string[]) => `Here it is.\n<ranking>${JSON.stringify(ids)}</ranking>`;

describe('experiments', () => {
  it('reads the form and a pasted list', () => {
    expect(factorsFromForm(FORM)).toEqual([
      { name: 'Build', levels: [{ name: 'By pay', instructions: 'Rank by pay, highest first.' }, { name: 'By letter', instructions: 'Rank by title, A first.' }] },
      { name: 'Preferences', levels: [{ name: 'Remote', inputs: { PREFERENCES: 'Remote only.' } }, { name: 'Office', inputs: { PREFERENCES: 'In an office.' } }] },
    ]);
    // Each kind of change sets its one thing; a version with no name is lettered; a change with one version is left out.
    expect(factorsFromForm({
      c1_kind: 'model', c1_v1_name: 'As it is', c1_v2_provider: 'codex', c1_v2_model: 'm-2', c1_v3_text: 'ignored for a model change',
      c2_name: 'Agent', c2_kind: 'version', c2_v1_version: '3', c2_v2_version: '4', c2_v2_name: 'Newest',
      c3_name: 'Lonely', c3_kind: 'instructions', c3_v1_text: 'Only one.',
    })).toEqual([
      { name: 'Change 1', levels: [{ name: 'As it is', provider: '', model: '' }, { name: 'B', provider: 'codex', model: 'm-2' }] },
      { name: 'Agent', levels: [{ name: 'A', version: 3 }, { name: 'Newest', version: 4 }] },
    ]);
    expect(nameFromQuestion('Does the build change its picks more than what the person asks for?')).toBe('Does the build change its picks more than what the person asks for');
    expect(nameFromQuestion(`${'word '.repeat(30)}?`).length).toBeLessThanOrEqual(71);
    expect(caseFromPaste(PASTE).items[0]).toEqual({ title: 'Role A', facts: { Pay: '$250,000', Remote: 'yes' } });
    const c = { id: 's', name: 's', items: [{ id: 'a', title: 'A', facts: {} }, { id: 'b', title: 'B', facts: {} }] };
    expect(parseRanking(ranking(['b', 'a']), c)).toEqual({ ranking: ['b', 'a'] });
    expect(parseRanking('no block', c)).toEqual({ error: 'It has no <ranking> block.' });
    expect(parseRanking(ranking(['b']), c)).toEqual({ error: 'It left out a. Rank every item.' });
    // Only the inputs the agent declares are passed.
    expect(Object.keys(cellInputs({ inputs: { ITEMS: { type: 'string' }, PREFERENCES: { type: 'string' } } } as never, c, { INSTRUCTIONS: 'x', PREFERENCES: 'y' }))).toEqual(['ITEMS', 'PREFERENCES']);
  });

  it('sets one up, runs every condition, and says what changed the result from the runs themselves', async () => {
    const app = await makeApp();
    expect(installExperimentRanker(ctx)).toBe(true);
    expect((await get(app, '/experiments')).text).toContain('No experiments yet.');
    const page = (await get(app, '/experiments/new')).text;
    expect(page).toContain('What do you want to find out?');
    expect(page).toContain('Experiment ranker (ranks a list as told)');
    // Five steps, opening on the first; no set chosen for you; the notebook is offered with it.
    expect(page).toContain('data-exp-open="1"');
    expect(page.match(/<section class="exp-step" data-exp-step="\d"/g)).toHaveLength(5);
    for (const step of ['The question', 'What stays the same', 'What changes', 'Which is better', 'Check it']) expect(page).toContain(`</span> ${step}</button>`);
    expect(page).not.toMatch(/name="from"[^>]* checked/);
    expect(page).toContain('How it is told to decide');
    expect(page).toContain('Do you also want to know which is better?');
    expect(page).toContain('name="notebook" value="1" checked');
    // A link that fills the changes in opens on the summary; one with only the question, on the set.
    const filled = (await get(app, '/experiments/new?question=Why%3F&c1_name=Model&c1_kind=model&c1_v2_model=m-2&c3_name=Third&c3_v1_text=x')).text;
    expect(filled).toContain('data-exp-open="5"');
    expect(filled).toContain('>Why?</textarea>');
    expect(filled).toContain('name="c1_name" value="Model"');
    expect(filled).toContain('name="c1_kind" value="model" data-exp-kind data-call="Model" data-placeholder="" checked');
    expect(filled).toContain('name="c1_v2_model" value="m-2"');
    // A change that came with text but no kind is instructions.
    expect(filled).toMatch(/name="c3_kind" value="instructions"[^>]* checked/);
    expect((await get(app, '/experiments/new?question=Why%3F')).text).toContain('data-exp-open="2"');
    const made = await post(app, '/experiments', FORM);
    expect(made.status).toBe(303);
    const id = idOf(made.headers.location);
    expect(decodeURIComponent(made.headers.location)).toContain('Nothing has run yet: a pass makes 8 runs.');
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    expect(s.get(id)).toMatchObject({ name: 'What changes the ranking', repeats: 2, topK: 4, task: { agentId: 'experiment-ranker' } });
    const before = (await get(app, `/experiments/${id}`)).text;
    expect(before).toContain('Not run yet.');
    expect(before).toContain('Run it (8 runs)');
    expect(before).toContain('<strong>By pay:</strong> instructions: “Rank by pay, highest first.”');

    // The stand-in ranks by what the build says and ignores the preferences; one run answers badly once, then well.
    const items = s.cases(id)[0].items;
    const byPay = [...items].sort((a, b) => Number(b.facts.Pay.replace(/\D/g, '')) - Number(a.facts.Pay.replace(/\D/g, ''))).map((i) => i.id);
    const byLetter = items.map((i) => i.id);
    const asked: Array<Record<string, string>> = [];
    let bad = 1;
    ctx.experimentTaskRun = async (inputs) => {
      asked.push(inputs);
      if (bad && inputs.INSTRUCTIONS.includes('pay')) { bad--; return ranking(byPay.slice(1)); }
      return ranking(inputs.INSTRUCTIONS.includes('pay') ? byPay : byLetter);
    };
    const ran = await post(app, `/experiments/${id}/run`);
    expect(decodeURIComponent(ran.headers.location)).toContain('Running.');
    await settle();
    // 8 cells, 9 runs (one tried again, told why).
    expect(asked).toHaveLength(9);
    expect(asked.some((a) => a.ERRORS.includes('It left out'))).toBe(true);
    expect(JSON.parse(asked[0].ITEMS)[0]).toEqual({ id: items[0].id, title: 'Role A', facts: { Pay: '$250,000', Remote: 'yes' } });
    expect(new Set(asked.map((a) => a.PREFERENCES))).toEqual(new Set(['Remote only.', 'In an office.']));
    const pass = s.passes(id)[0];
    expect(pass.note).toBe('8 of 8 run.');
    expect(s.cells(pass.id).every((c) => c.status === 'done')).toBe(true);

    const after = (await get(app, `/experiments/${id}`)).text;
    expect(after).toContain('Build changed the result; preferences did not, beyond run-to-run variation.');
    expect(after).toContain('4 conditions, 2 runs of each. It holds for this set only.');
    expect(after).toContain('places moved by changing build');
    expect(after).toContain('Where each item landed');
    expect(after).toContain('Run it again');
    expect((await get(app, `/experiments/${id}/state`)).body).toMatchObject({ running: false });
    expect((await get(app, '/experiments')).text).toContain('Build changed the result; preferences did not');
    expect((await get(app, '/experiments/nope')).status).toBe(404);
  });

  it('copies a notebook\'s options once, stops and goes on, and refuses what it cannot run', async () => {
    const app = await makeApp();
    const nbs = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = nbs.create({ title: 'Jobs', statement: 'Find jobs', params: [], criteria: [] });
    nbs.setFields(nb.id, [{ key: 'pay', label: 'Pay', type: 'money', role: 'price', better: 'higher' }, { key: 'company', label: 'Company', type: 'text', role: 'org' }]);
    for (const [title, pay, company] of [['Staff Engineer', 250000, 'Acme'], ['Staff Engineer', 210000, 'Globex'], ['Designer', 150000, 'Initech']] as const) nbs.upsertOption(nb.id, { title, data: { pay, company }, by: 'you' });
    const picker = (await get(app, '/experiments/new')).text;
    expect(picker).toContain('<span class="exp-choice__title">Jobs</span>');
    expect(picker).toContain('3 options: Acme · Staff Engineer · Designer · Globex · Staff Engineer');

    const made = await post(app, '/experiments', { name: 'From a notebook', from: nb.id, repeats: '2', c1_name: 'Build', c1_v1_name: 'A', c1_v2_name: 'B', c1_v2_text: 'Other way.' });
    const id = idOf(made.headers.location);
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    const items = s.cases(id)[0].items;
    // In name order, not the notebook's ranking; same-named options carry their company; facts as the page shows them.
    expect(items.map((i) => i.id)).toEqual(['acme-staff-engineer', 'designer', 'globex-staff-engineer']);
    expect(items[0].facts).toMatchObject({ Company: 'Acme' });
    expect(s.get(id)!.from).toEqual({ notebookId: nb.id, title: 'Jobs' });
    // The notebook changing afterwards changes nothing here.
    nbs.upsertOption(nb.id, { title: 'Late arrival', data: { pay: 1 }, by: 'you' });
    expect(s.cases(id)[0].items).toHaveLength(3);
    const setup = (await get(app, `/experiments/${id}`)).text;
    expect(setup).toContain(`copied from <a href="/notebooks/${nb.id}">Jobs</a>`);

    // Stop during the first runs (two go at a time); Go on runs the rest.
    const ids = items.map((i) => i.id);
    let stopping: Promise<unknown> | undefined;
    ctx.experimentTaskRun = async () => { stopping ??= post(app, `/experiments/${id}/stop`).then((r) => r); await stopping; return ranking(ids); };
    await post(app, `/experiments/${id}/run`);
    await settle();
    const pass = s.passes(id)[0];
    expect(s.cells(pass.id).map((c) => c.status).sort()).toEqual(['done', 'done', 'stopped', 'stopped']);
    expect((await get(app, `/experiments/${id}`)).text).toContain('Go on (2 runs left)');
    ctx.experimentTaskRun = async () => ranking(ids);
    expect(decodeURIComponent((await post(app, `/experiments/${id}/resume`)).headers.location)).toContain('Going on from where it stopped.');
    await settle();
    expect(s.cells(pass.id).every((c) => c.status === 'done')).toBe(true);
    // Every run agreed: nothing moved it more than a repeat did.
    expect((await get(app, `/experiments/${id}`)).text).toContain('No factor changed the result more than running the same thing twice did.');

    // A cell left running by a restart is stopped, to be resumed.
    const again = s.startPass(id);
    s.claimCell(again.id);
    expect(reconcileExperimentsOnBoot(ctx)).toBe(1);
    expect((await get(app, `/experiments/${id}`)).text).toContain('Go on (4 runs left)');

    // Refusals come back to the form with what was typed.
    expect((await post(app, '/experiments', { name: 'No set' })).text).toContain('Choose the notebook whose options to hold fixed, or paste a list.');
    const none = await post(app, '/experiments', { name: 'Nothing to rank', from: 'paste', paste: 'Only one', c1_name: 'Kept', c1_v1_name: 'Typed' });
    expect(none.status).toBe(400);
    expect(none.text).toContain('It needs a set of at least two items to rank.');
    expect(none.text).toContain('value="Nothing to rank"');
    // It comes back on the step the problem belongs to.
    expect(none.text).toContain('data-exp-open="2"');
    expect(none.text).toContain('name="c1_name" value="Kept"');
    expect(none.text).toContain('name="c1_v1_name" value="Typed"');
    // With no name, the question names it.
    const named = await post(app, '/experiments', { question: 'Does order matter?', paste: PASTE });
    expect(s.get(idOf(named.headers.location))).toMatchObject({ name: 'Does order matter', question: 'Does order matter?', factors: [] });
    // Archive stops it and takes it off the list; restore brings it back.
    await post(app, `/experiments/${id}/archive`);
    expect((await get(app, '/experiments')).text).toContain('1 archived experiment');
    expect((await get(app, '/experiments?archived=1')).text).toContain('From a notebook');
    await post(app, `/experiments/${id}/archive`, { restore: '1' });
    expect(s.get(id)!.archivedAt).toBeUndefined();
  });

  it('scores each result: a counted scorer and a judge that never sees the build, kept only with a usable answer', async () => {
    const app = await makeApp();
    expect(() => scorersFromForm({ top_items: 'Role Z' }, [{ id: 's', name: 's', items: [{ id: 'role-a', title: 'Role A', facts: {} }] }])).toThrow('"Role Z" matches none of the items.');
    const made = await post(app, '/experiments', { ...FORM, repeats: '1', top_items: 'role a\nRole D', j1_name: 'Respects preferences', j1_rubric: 'The top two fit what the person asked for.' });
    const id = idOf(made.headers.location);
    // 4 conditions, each read by the judge: 8 runs.
    expect(decodeURIComponent(made.headers.location)).toContain('a pass makes 8 runs');
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    const e = s.get(id)!;
    expect(e.scorers).toMatchObject([{ kind: 'top', name: 'Should be near the top', items: ['role-a', 'role-d'], k: 4 }, { kind: 'judge', name: 'Respects preferences' }]);
    const ids = s.cases(id)[0].items.map((i) => i.id);
    ctx.experimentTaskRun = async (inputs) => ranking(inputs.INSTRUCTIONS.includes('pay') ? ['role-d', 'role-a', 'role-b', 'role-c', 'role-e'] : ['role-b', 'role-c', 'role-e', 'role-a', 'role-d']);
    const judged: Array<Record<string, string>> = [];
    let bad = 1;
    ctx.experimentJudgeRun = async (inputs) => {
      judged.push(inputs);
      if (bad) { bad--; return '<score>{"score": 0.9, "reason": "Fine."}</score>'; }
      if (inputs.PREFERENCES.includes('office') && JSON.parse(inputs.RANKING)[0] === 'role-b') return 'I cannot say.';
      return `<score>${JSON.stringify({ score: JSON.parse(inputs.RANKING)[0] === 'role-d' ? 0.25 : 1, reason: 'The first two are placed as asked.', cites: [ids[0]] })}</score>`;
    };
    await post(app, `/experiments/${id}/run`);
    await settle();
    // The judge sees the rubric, the preferences, the items and the ranking; never the build's instructions.
    expect(Object.keys(judged[0]).sort()).toEqual(['ERRORS', 'ITEMS', 'PREFERENCES', 'RANKING', 'RUBRIC']);
    expect(judged.some((j) => j.ERRORS.includes('It cites no item.'))).toBe(true);
    const pass = s.passes(id)[0];
    const scores = s.scores(pass.id);
    expect(scores).toHaveLength(4);
    // One result got no usable answer from the judge twice: it stands, without that score.
    expect(scores.filter((x) => x.value === undefined)).toMatchObject([{ error: 'It has no <score> block.' }]);
    expect(s.cells(pass.id).every((c) => c.status === 'done')).toBe(true);
    const page = (await get(app, `/experiments/${id}`)).text;
    expect(page).toContain('<th scope="col" class="exp-n">Should be near the top</th><th scope="col" class="exp-n">Respects preferences</th>');
    // By pay: both named items in the top 4 (100%), the judge gives 25%. By letter: one of two (50%).
    expect(page).toContain('<td class="exp-n">100%</td><td class="exp-n">25%</td>');
    expect(page).toContain('<td class="exp-n">50%</td>');
    expect(page).toContain('judged: “The top two fit what the person asked for.”');
    expect(page).toContain('<strong>Respects preferences:</strong> 25%. The first two are placed as asked.');
    expect(page).toContain('no score: It has no &lt;score&gt; block.');
    expect((await get(app, '/experiments/new')).text).toContain('Have a model judge it');
    // A scorer that names no item comes back on the scoring step.
    const typo = await post(app, '/experiments', { ...FORM, top_items: 'Role Z' });
    expect(typo.status).toBe(400);
    expect(typo.text).toContain('data-exp-open="4"');
    expect(typo.text).toContain('>Role Z</textarea>');
  });

  it('shows its results in a notebook made for it: one notebook, read from the runs, with nothing to decide', async () => {
    const app = await makeApp();
    const id = idOf((await post(app, '/experiments', FORM)).headers.location);
    expect((await get(app, `/experiments/${id}`)).text).toContain('Show it in a notebook');
    const made = await post(app, `/experiments/${id}/notebook`);
    const nbId = decodeURIComponent(made.headers.location).split('/notebooks/')[1].split('?')[0];
    expect(decodeURIComponent(made.headers.location)).toContain('This notebook shows the experiment\'s results as they stand');
    const nbs = NotebookStore.fromHandle(runStore.databaseHandle());
    expect(nbs.get(nbId)).toMatchObject({ title: 'What changes the ranking', statement: 'Build or preferences?', experimentId: id, layoutBy: 'experiment' });
    // Asking again opens the same one; the experiment's page links to it.
    expect((await post(app, `/experiments/${id}/notebook`)).headers.location).toContain(`/notebooks/${nbId}?`);
    expect(nbs.list().filter((n) => n.experimentId === id)).toHaveLength(1);
    expect((await get(app, `/experiments/${id}`)).text).toContain(`href="/notebooks/${nbId}">Open its notebook</a>`);

    const before = (await get(app, `/notebooks/${nbId}`)).text;
    expect(before).toContain('Open the experiment</a>');
    expect(before).not.toContain('Decide…');
    expect(before).toContain('Ask what the results mean, or what to try next.');
    expect(before).toContain('Nothing has run yet.');

    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    const items = s.cases(id)[0].items.map((i) => i.id);
    ctx.experimentTaskRun = async (inputs) => ranking(inputs.INSTRUCTIONS.includes('pay') ? [...items].reverse() : items);
    const stamp = nbs.get(nbId)!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await post(app, `/experiments/${id}/run`);
    await settle();
    // The notebook is told its results moved on, and its page reads them.
    expect(nbs.get(nbId)!.updatedAt > stamp).toBe(true);
    const after = (await get(app, `/notebooks/${nbId}`)).text;
    expect(after).toContain('Build changed the result; preferences did not, beyond run-to-run variation.');
    expect(after).toContain('places moved by changing build');
    expect(after).toContain('By letter · Office');
    // Archiving the notebook leaves the experiment; asking again brings the notebook back.
    nbs.archive(nbId);
    expect((await get(app, `/experiments/${id}`)).text).toContain('Show it in a notebook');
    await post(app, `/experiments/${id}/notebook`);
    expect(nbs.get(nbId)!.archivedAt).toBeUndefined();
  });

  it('sua is told what each experiment found in its page\'s words, and a link from sua fills the page in and makes the notebook', async () => {
    const app = await makeApp();
    const { experimentsForTriage } = await import('../lib/experiment-notebook.js');
    expect(experimentsForTriage(ctx)).toBe('[]');
    // The link sua offers: the question, two changes, and the notebook asked for with it.
    const link = '/experiments/new?question=Does%20order%20matter%3F&notebook=1&c1_name=Build&c1_kind=instructions&c1_v1_name=By%20pay&c1_v1_text=Rank%20by%20pay.&c1_v2_name=By%20letter&c1_v2_text=Rank%20by%20title.';
    const page = (await get(app, link)).text;
    expect(page).toContain('name="notebook" value="1" checked');
    expect(page).toContain('name="c1_v2_name" value="By letter"');
    expect(page).toContain('>Rank by title.</textarea>');
    const made = await post(app, '/experiments', { ...FORM, notebook: '1' });
    const id = idOf(made.headers.location);
    expect(decodeURIComponent(made.headers.location)).toContain('Its notebook is made too');
    const nbs = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = nbs.forExperiment(id)!;
    expect(nb.experimentId).toBe(id);
    let told = JSON.parse(experimentsForTriage(ctx)) as Array<Record<string, unknown>>;
    expect(told).toMatchObject([{ id, name: 'What changes the ranking', stands: 'not run yet', changes: ['Build: By pay | By letter', 'Preferences: Remote | Office'], link: `/experiments/${id}`, notebook: `/notebooks/${nb.id}` }]);
    expect(told[0].found).toBeUndefined();
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    const items = s.cases(id)[0].items.map((i) => i.id);
    ctx.experimentTaskRun = async (inputs) => ranking(inputs.INSTRUCTIONS.includes('pay') ? [...items].reverse() : items);
    await post(app, `/experiments/${id}/run`);
    await settle();
    told = JSON.parse(experimentsForTriage(ctx)) as Array<Record<string, unknown>>;
    expect(told[0]).toMatchObject({ stands: '8 of 8 runs', restsOn: '1 set, 4 conditions, 2 runs of each. It holds for this set only.' });
    expect(String(told[0].found)).toMatch(/^Build changed the result; preferences did not, beyond run-to-run variation\./);
  });

  it('suggests the set: the notebook that fits the question, a golden set of a long one, and its picks as the answer key', async () => {
    const app = await makeApp();
    const nbs = NotebookStore.fromHandle(runStore.databaseHandle());
    const jobs = nbs.create({ title: 'Find fitting jobs', statement: 'Job openings that fit', params: [], criteria: [] });
    nbs.setFields(jobs.id, [{ key: 'pay', label: 'Pay', type: 'money', role: 'price', better: 'higher' }, { key: 'fit', label: 'Fit', type: 'number', role: 'score' }]);
    const ids = Array.from({ length: 16 }, (_, i) => nbs.upsertOption(jobs.id, { title: `Job ${String(i + 1).padStart(2, '0')}`, data: { pay: 400 - i * 10, fit: 90 - i }, by: 'you' }).entry.id);
    nbs.choose(jobs.id, ids[2]);
    nbs.choose(jobs.id, ids[5]);
    nbs.ruleOut(jobs.id, ids[15], 'Too junior', 'you');
    const cars = nbs.create({ title: 'Buy a car', statement: 'A used car', params: [], criteria: [] });
    nbs.setFields(cars.id, [{ key: 'price', label: 'Price', type: 'money', role: 'price' }]);
    for (const t of ['Car A', 'Car B', 'Car C']) nbs.upsertOption(cars.id, { title: t, data: { price: 9000 }, by: 'you' });

    // Ranked for the question: the job notebook leads and is marked; the other says why not.
    const sets = (await get(app, '/experiments/sets?question=Does%20the%20job%20agent%27s%20build%20change%20which%20jobs%20it%20picks%3F')).text;
    expect(sets.indexOf('Find fitting jobs')).toBeLessThan(sets.indexOf('Buy a car'));
    expect(sets).toContain('Find fitting jobs <span class="badge badge--ok">Suggested</span>');
    expect(sets).toContain('For it: about job, as your question is; pay noted for every option; you picked 2 of them, so results can be scored against your picks; 1 ruled out with a reason, which a good result should keep low.');
    expect(sets).toContain('Against it: only 3 options, so results will be coarse; not about what your question asks.');
    expect(sets).not.toMatch(/name="from"[^>]* checked/);
    // With no question, nothing is suggested on topic alone, but the page still lists them.
    expect((await get(app, '/experiments/new')).text).toContain('Find fitting jobs');

    // What would be copied from it: a golden set of 10 of the 15 in the running, with the two picks and the one ruled out.
    const panel = (await get(app, `/experiments/sets?panel=1&from=${jobs.id}`)).text;
    expect(panel).toContain('sua suggests a golden set of 10 in place of all 15: your 2 picks; 7 of the rest, spread from best to worst by fit; and 1 you ruled out (a good result keeps it low). Fewer items make quicker, clearer runs.');
    expect(panel.match(/data-exp-item checked/g)).toHaveLength(10);
    expect(panel.match(/data-exp-item/g)).toHaveLength(16);
    expect(panel).toContain('Job 03 <span class="badge badge--ok">your pick</span>');
    expect(panel).toContain('<span class="badge badge--muted">ruled out</span> <span class="exp-set__reason">Too junior</span>');
    expect(panel).toContain(`name="key_${jobs.id}" value="1" data-exp-key checked`);
    expect(panel).toContain('Score each result against your 2 picks: Job 03, Job 06; and against keeping what you ruled out low.');

    // Set it up with five of them and the answer key: only those are frozen, without the notebook's own fit score, and scored against the picks.
    const kept = [ids[0], ids[2], ids[5], ids[9], ids[15]];
    const body = new URLSearchParams({ name: 'Golden', from: jobs.id, [`key_${jobs.id}`]: '1' });
    for (const id of kept) body.append(`items_${jobs.id}`, id);
    const made = await request(app).post('/experiments').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body.toString());
    expect(made.status).toBe(303);
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    const e = s.get(idOf(made.headers.location))!;
    const items = s.cases(e.id)[0].items;
    expect(items.map((i) => i.id)).toEqual(['job-01', 'job-03', 'job-06', 'job-10', 'job-16']);
    expect(items[0].facts).toEqual({ Pay: '$400' });
    expect(e.scorers).toEqual([
      { id: 'your-picks-near-the-top', name: 'Your picks near the top', kind: 'top', items: ['job-03', 'job-06'], k: 4 },
      { id: 'ruled-out-ones-kept-low', name: 'Ruled-out ones kept low', kind: 'top', items: ['job-16'], k: 3, avoid: true },
    ]);
    const page = (await get(app, `/experiments/${e.id}`)).text;
    expect(page).toContain('5 items, copied from');
    expect(page).toContain('(Job 16) kept out of the top 3');
    // A ranking that puts the picks first and the ruled-out one last scores 100% on both.
    ctx.experimentTaskRun = async () => ranking(['job-03', 'job-06', 'job-01', 'job-10', 'job-16']);
    await post(app, `/experiments/${e.id}/run`);
    await settle();
    expect((await get(app, `/experiments/${e.id}`)).text).toContain('<td class="exp-n">100%</td><td class="exp-n">100%</td>');

    // Fewer than two kept is refused, back on the set step with what was ticked.
    const one = new URLSearchParams({ name: 'Too few', from: jobs.id });
    one.append(`items_${jobs.id}`, ids[0]);
    const refused = await request(app).post('/experiments').set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(one.toString());
    expect(refused.status).toBe(400);
    expect(refused.text).toContain('Keep at least two items in the set');
    expect(refused.text).toContain('data-exp-open="2"');
    expect(refused.text.match(/data-exp-item checked/g)).toHaveLength(1);
    // Nothing ticked at all (a page without scripts): every option in the running is used, as before.
    const all = await post(app, '/experiments', { name: 'Everything', from: jobs.id });
    expect(s.cases(idOf(all.headers.location))[0].items).toHaveLength(15);
  });
});
