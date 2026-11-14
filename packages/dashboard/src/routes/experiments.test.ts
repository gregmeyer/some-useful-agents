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
import { factorsFromForm, scorersFromForm } from './experiments.js';

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
  f1_name: 'Build', f1_l1_name: 'By pay', f1_l1_instructions: 'Rank by pay, highest first.', f1_l2_name: 'By letter', f1_l2_instructions: 'Rank by title, A first.',
  f2_name: 'Preferences', f2_l1_name: 'Remote', f2_l1_preferences: 'Remote only.', f2_l2_name: 'Office', f2_l2_preferences: 'In an office.',
};
const ranking = (ids: string[]) => `Here it is.\n<ranking>${JSON.stringify(ids)}</ranking>`;

describe('experiments', () => {
  it('reads the form and a pasted list', () => {
    expect(factorsFromForm(FORM)).toEqual([
      { name: 'Build', levels: [{ name: 'By pay', instructions: 'Rank by pay, highest first.', provider: '', model: '', version: undefined }, { name: 'By letter', instructions: 'Rank by title, A first.', provider: '', model: '', version: undefined }] },
      { name: 'Preferences', levels: [{ name: 'Remote', instructions: '', provider: '', model: '', version: undefined, inputs: { PREFERENCES: 'Remote only.' } }, { name: 'Office', instructions: '', provider: '', model: '', version: undefined, inputs: { PREFERENCES: 'In an office.' } }] },
    ]);
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
    expect(page).toContain('The set to hold fixed');
    expect(page).toContain('Experiment ranker (ranks a list as instructed)');

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
    expect((await get(app, '/experiments/new')).text).toContain('Jobs (3 options)');

    const made = await post(app, '/experiments', { name: 'From a notebook', from: nb.id, repeats: '2', f1_name: 'Build', f1_l1_name: 'A', f1_l2_name: 'B', f1_l2_instructions: 'Other way.' });
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
    const none = await post(app, '/experiments', { name: 'Nothing to rank', paste: 'Only one' });
    expect(none.status).toBe(400);
    expect(none.text).toContain('It needs a set of at least two items to rank.');
    expect(none.text).toContain('value="Nothing to rank"');
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
    expect((await get(app, '/experiments/new')).text).toContain('How to score each result (optional)');
  });
});
