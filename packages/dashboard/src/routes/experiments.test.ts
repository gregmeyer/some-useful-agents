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
import { cellInputs, parseJudgement, reconcileExperimentsOnBoot, testableAgents } from '../lib/experiment-runner.js';
import { askFromForm, factorsFromForm, nameFromQuestion, scorersFromForm } from './experiments.js';

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

/** What a run of the stand-in agent prints: a list of jobs as JSON, as a real search agent would. */
const jobs = (titles: string[]) => `Here is what I found.\n\`\`\`json\n${JSON.stringify({ jobs: titles.map((t) => ({ title: t, company: 'Acme', url: `https://jobs.example/${t.toLowerCase().replace(/\W+/g, '-')}` })) })}\n\`\`\``;
const OLD = ['Role A', 'Role B', 'Role C', 'Role D'];
const NEW = ['Role A', 'Role E', 'Role F', 'Role G'];

/** An agent of the operator's with two versions, two inputs, and a run behind it. */
function finder() {
  agentStore.createAgent({ id: 'job-finder', name: 'Job finder', description: 'Finds jobs', status: 'active', source: 'local', mcp: false,
    inputs: { TOPIC: { type: 'string', required: true, description: 'What to look for' }, PREFERENCES: { type: 'string', required: false, default: '' } },
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }] } as never, 'cli');
  agentStore.createNewVersion('job-finder', { ...agentStore.getAgent('job-finder')!, description: 'Finds jobs, better' }, 'dashboard', 'Tighter search');
  agentStore.createAgent({ id: 'idle-agent', name: 'Idle agent', status: 'active', source: 'local', mcp: false, nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }] }, 'cli');
  runStore.createRun({ id: 'run-1', agentName: 'job-finder', status: 'completed', startedAt: '2026-11-12T10:00:00.000Z', completedAt: '2026-11-12T10:00:00.000Z', result: jobs(OLD), triggeredBy: 'dashboard' });
}
const FORM = {
  question: 'Does the new version find different jobs?', agent: 'job-finder', in_TOPIC: 'staff engineer jobs', repeats: '2',
  c1_kind: 'version', c1_name: 'Build', c1_v1_name: 'Old', c1_v1_version: '1', c1_v2_name: 'New', c1_v2_version: '2',
};

describe('experiments', () => {
  it('reads the form: changes by kind, the ask, and what to score', () => {
    expect(factorsFromForm({ ...FORM, c2_kind: 'input', c2_input: 'PREFERENCES', c2_v1_name: 'Remote', c2_v1_text: 'Remote only.', c2_v2_text: 'An office.', c3_kind: 'model', c3_v1_name: 'As it is', c3_v2_provider: 'codex', c3_v2_model: 'm-2' })).toEqual([
      { name: 'Build', levels: [{ name: 'Old', version: 1 }, { name: 'New', version: 2 }] },
      { name: 'PREFERENCES', levels: [{ name: 'Remote', inputs: { PREFERENCES: 'Remote only.' } }, { name: 'B', inputs: { PREFERENCES: 'An office.' } }] },
      { name: 'Model', levels: [{ name: 'As it is', provider: '', model: '' }, { name: 'B', provider: 'codex', model: 'm-2' }] },
    ]);
    // A change with one version is left out.
    expect(factorsFromForm({ c1_kind: 'version', c1_v1_version: '3' })).toEqual([]);
    expect(askFromForm(FORM)).toEqual({ TOPIC: 'staff engineer jobs' });
    expect(scorersFromForm({ should_find: 'Role A\n\nRole E', should_not_find: 'intern', j1_rubric: 'All remote.', j1_name: 'Remote' })).toEqual([
      { kind: 'found', name: 'Found what it should', items: ['Role A', 'Role E'] },
      { kind: 'found', avoid: true, name: 'Left out what it should', items: ['intern'] },
      { kind: 'judge', name: 'Remote', rubric: 'All remote.', provider: '', model: '' },
    ]);
    expect(nameFromQuestion('Does the new version find different jobs?')).toBe('Does the new version find different jobs');
    // A run is given the ask with its version's changes over it, and only inputs the agent declares.
    expect(cellInputs({ inputs: { TOPIC: {}, PREFERENCES: {} } } as never, { TOPIC: 'jobs', OTHER: 'x' }, { PREFERENCES: 'Remote.' })).toEqual({ TOPIC: 'jobs', PREFERENCES: 'Remote.' });
    expect(parseJudgement('<score>{"score": 0.5, "reason": "Half.", "cites": [2]}</score>', 3)).toEqual({ value: 0.5, reason: 'Half.', cites: ['2'] });
    expect(parseJudgement('no block', 3)).toEqual({ error: 'It has no <score> block.' });
  });

  it('offers the operator\'s agents by how much they ran, with their inputs, versions and whether their results can be read', async () => {
    const app = await makeApp();
    expect((await get(app, '/experiments')).text).toContain('No experiments yet.');
    expect((await get(app, '/experiments/new')).text).toContain('You have no agents of your own yet.');
    finder();
    const agents = testableAgents(ctx);
    expect(agents.map((a) => [a.id, a.runs, a.versions.length, a.lists])).toEqual([['job-finder', 1, 2, 4], ['idle-agent', 0, 1, undefined]]);
    expect(agents[0].inputs).toEqual([{ name: 'TOPIC', description: 'What to look for', required: true }, { name: 'PREFERENCES' }]);
    const page = (await get(app, '/experiments/new')).text;
    expect(page).toContain('data-exp-open="1"');
    expect(page.match(/<section class="exp-step" data-exp-step="\d"/g)).toHaveLength(6);
    for (const step of ['The question', 'What to run', 'What you ask it', 'What changes', 'Which is better', 'Check it']) expect(page).toContain(`</span> ${step}</button>`);
    expect(page.indexOf('value="job-finder"')).toBeLessThan(page.indexOf('value="idle-agent"'));
    expect(page).toContain('Run 1 time · 2 versions, now on 2 · its last run listed 4 items');
    expect(page).not.toMatch(/name="agent"[^>]* checked/);
    expect(page).not.toContain('value="inbox-triage"');
    expect(page).toContain('Which version of the agent runs');
    expect(page).toContain('Something you ask it');
    // A link that names the agent and a change opens on the summary, with the ask drawn for that agent.
    const filled = (await get(app, '/experiments/new?question=Why%3F&agent=job-finder&in_TOPIC=jobs&c1_kind=version&c1_v1_version=1&c1_v2_version=2')).text;
    expect(filled).toContain('data-exp-open="6"');
    expect(filled).toMatch(/name="agent" value="job-finder"[^>]* checked/);
    expect(filled).toContain('<textarea class="form-field__textarea" name="in_TOPIC" rows="2">jobs</textarea>');
    expect(filled).toMatch(/name="c1_kind" value="version"[^>]* checked/);
    expect((await get(app, '/experiments/new?question=Why%3F')).text).toContain('data-exp-open="2"');
  });

  it('runs the whole agent under each version and says what changed what it produced, from the runs themselves', async () => {
    const app = await makeApp();
    finder();
    const made = await post(app, '/experiments', { ...FORM, should_find: 'Role A\nRole E', notebook: '1' });
    expect(made.status).toBe(303);
    const id = idOf(made.headers.location);
    expect(decodeURIComponent(made.headers.location)).toContain('a pass runs Job finder 4 times');
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    expect(s.get(id)).toMatchObject({ name: 'Does the new version find different jobs', repeats: 2, task: { agentId: 'job-finder' }, inputs: { TOPIC: 'staff engineer jobs' }, factors: [{ name: 'Build', levels: [{ version: 1 }, { version: 2 }] }] });
    const before = (await get(app, `/experiments/${id}`)).text;
    expect(before).toContain('Not run yet.');
    expect(before).toContain('Run it (4 runs of the agent)');
    expect(before).toContain('<strong>TOPIC:</strong> staff engineer jobs');
    expect(before).toContain('<strong>Old (baseline):</strong> agent version 1');

    // Version 1 finds one list, version 2 mostly another; one run of the old one misses a job.
    const asked: Array<{ inputs: Record<string, string>; at: { conditionId: string; repeat: number } }> = [];
    ctx.experimentTaskRun = async (inputs, at) => { asked.push({ inputs, at }); return jobs(at.conditionId === 'old' ? (at.repeat === 2 ? OLD.slice(0, 3) : OLD) : NEW); };
    const ran = await post(app, `/experiments/${id}/run`);
    expect(decodeURIComponent(ran.headers.location)).toContain('Running.');
    await settle();
    expect(asked).toHaveLength(4);
    expect(asked.every((a) => a.inputs.TOPIC === 'staff engineer jobs')).toBe(true);
    const pass = s.passes(id)[0];
    expect(pass.note).toBe('4 of 4 run.');
    const cells = s.cells(pass.id);
    expect(cells.every((c) => c.status === 'done')).toBe(true);
    expect(cells[0].items![0]).toEqual({ key: 'link:jobs.example/role-a', title: 'Role A', link: 'https://jobs.example/role-a', facts: { Company: 'Acme' } });

    const after = (await get(app, `/experiments/${id}`)).text;
    expect(after).toContain('Build changed what it produced, beyond run-to-run variation.');
    expect(after).toContain('2 versions, 2 runs of each. It holds for this ask, when it was run.');
    expect(after).toContain('of what they found was in both, when build changed');
    expect(after).toContain('What each version found');
    // A job only the old version found, and the one both found (linked).
    expect(after).toMatch(/Role B<\/a><\/th>\s*<td class="exp-n">all 2, place 2<\/td><td class="exp-n exp-n--miss">not found<\/td>/);
    expect(after).toContain('<a href="https://jobs.example/role-a" target="_blank" rel="noopener noreferrer">Role A</a>');
    // Scored: the old version found one of the two named, the new both.
    expect(after).toContain('<th scope="col" class="exp-n">Found what it should</th>');
    expect(after).toContain('<td class="exp-n">50%</td>');
    expect(after).toContain('<td class="exp-n">100%</td>');
    expect(after).toContain('Run it again');
    expect((await get(app, `/experiments/${id}/state`)).body).toMatchObject({ running: false });
    expect((await get(app, '/experiments')).text).toContain('Build changed what it produced, beyond run-to-run variation.');
    expect((await get(app, '/experiments/nope')).status).toBe(404);

    // The notebook made with it shows the same finding and table, and offers nothing to decide.
    const nbs = NotebookStore.fromHandle(runStore.databaseHandle());
    const nb = nbs.forExperiment(id)!;
    expect(nb).toMatchObject({ experimentId: id, layoutBy: 'experiment' });
    const nbPage = (await get(app, `/notebooks/${nb.id}`)).text;
    expect(nbPage).toContain('Build changed what it produced, beyond run-to-run variation.');
    expect(nbPage).toContain('Open the experiment</a>');
    expect(nbPage).not.toContain('Decide…');
    // It has a brief to download or print: the finding, the numbers, and how it was run, so the page stands by itself.
    expect(nbPage).toContain('Download / share');
    expect(nbPage).toContain(`href="/notebooks/${nb.id}/brief.pdf"`);
    expect(nbPage).not.toContain('shortlist.csv');
    const brief = (await get(app, `/notebooks/${nb.id}/brief.html`)).text;
    expect(brief).toContain('Build changed what it produced, beyond run-to-run variation.');
    expect(brief).toMatch(/<h2 data-n="\d+">How it was run<\/h2>/);
    expect(brief).toContain('<dt>What was run</dt><dd>The whole of job-finder, 2 times for each version.');
    expect(brief).toContain('<dt>Changed: Build</dt>');
    expect(brief).toContain('(baseline):');
    expect(brief).toContain('From the experiment as it stood on');
    expect(brief).not.toContain('facts as their pages gave them');
    // And the agent's own page says what was found, while its own history has none of these runs.
    const agentPage = (await get(app, '/agents/job-finder')).text;
    expect(agentPage).toContain('Experiments on this agent');
    expect(agentPage).toContain('Build changed what it produced, beyond run-to-run variation.');
  });

  it('marks a run unusable when its output has no list, stops and goes on, and survives a restart', async () => {
    const app = await makeApp();
    finder();
    const id = idOf((await post(app, '/experiments', FORM)).headers.location);
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    // One run answers in prose; one lists nothing (a result); two list jobs.
    ctx.experimentTaskRun = async (_inputs, at) => (at.conditionId === 'old' ? (at.repeat === 1 ? 'I could not find anything useful today, sorry.' : jobs(OLD)) : (at.repeat === 1 ? '{"jobs": []}' : jobs(NEW)));
    await post(app, `/experiments/${id}/run`);
    await settle();
    const pass = s.passes(id)[0];
    const cells = s.cells(pass.id);
    expect(cells.map((c) => [c.conditionId, c.repeat, c.status, c.items?.length])).toEqual([['old', 1, 'invalid', undefined], ['new', 1, 'done', 0], ['old', 2, 'done', 4], ['new', 2, 'done', 4]]);
    expect(cells[0].error).toContain('Its output has no list of items sua could read');
    const page = (await get(app, `/experiments/${id}`)).text;
    expect(page).toContain('1 run couldn&#39;t be used and is not counted.');
    expect(page).toContain('Try the 1 unusable again');
    // Trying it again runs only that one.
    let n = 0;
    ctx.experimentTaskRun = async () => { n++; return jobs(OLD); };
    await post(app, `/experiments/${id}/resume`, { retry: '1' });
    await settle();
    expect(n).toBe(1);
    expect(s.cells(pass.id).every((c) => c.status === 'done')).toBe(true);

    // Stop during the first runs (two go at a time); Go on runs the rest.
    let stopping: Promise<unknown> | undefined;
    ctx.experimentTaskRun = async () => { stopping ??= post(app, `/experiments/${id}/stop`).then((r) => r); await stopping; return jobs(OLD); };
    await post(app, `/experiments/${id}/run`);
    await settle();
    const second = s.passes(id)[0];
    expect(s.cells(second.id).map((c) => c.status).sort()).toEqual(['done', 'done', 'stopped', 'stopped']);
    expect((await get(app, `/experiments/${id}`)).text).toContain('Go on (2 runs left)');
    ctx.experimentTaskRun = async () => jobs(OLD);
    await post(app, `/experiments/${id}/resume`);
    await settle();
    expect(s.cells(second.id).every((c) => c.status === 'done')).toBe(true);
    // Every run found the same things: nothing changed it more than a repeat did.
    expect((await get(app, `/experiments/${id}`)).text).toContain('No change altered what it produced more than running the same version twice did.');
    // A cell left running by a restart is stopped, to be resumed.
    const third = s.startPass(id);
    s.claimCell(third.id);
    expect(reconcileExperimentsOnBoot(ctx)).toBe(1);
    expect((await get(app, `/experiments/${id}`)).text).toContain('Go on (4 runs left)');
    await post(app, `/experiments/${id}/archive`);
    expect((await get(app, '/experiments')).text).toContain('1 archived experiment');
  });

  it('refuses what it cannot run, back on the step the problem belongs to, with what was typed', async () => {
    const app = await makeApp();
    finder();
    const none = await post(app, '/experiments', { question: 'No agent?' });
    expect(none.status).toBe(400);
    expect(none.text).toContain('Choose what to run.');
    expect(none.text).toContain('data-exp-open="2"');
    expect(none.text).toContain('>No agent?</textarea>');
    // An input the agent needs, given neither in the ask nor by a change.
    const noTopic = await post(app, '/experiments', { ...FORM, in_TOPIC: '' });
    expect(noTopic.text).toContain('Job finder needs a value for TOPIC.');
    expect(noTopic.text).toContain('data-exp-open="3"');
    expect(noTopic.text).toMatch(/name="c1_v1_version"[^>]* value="1"/);
    // The same input set by every version of a change is enough.
    const byChange = await post(app, '/experiments', { question: 'Which topic?', agent: 'job-finder', c1_kind: 'input', c1_input: 'TOPIC', c1_v1_name: 'Staff', c1_v1_text: 'staff jobs', c1_v2_name: 'Director', c1_v2_text: 'director jobs' });
    expect(byChange.status).toBe(303);
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    expect(s.get(idOf(byChange.headers.location))!.factors[0]).toMatchObject({ name: 'TOPIC', levels: [{ name: 'Staff', inputs: { TOPIC: 'staff jobs' } }, { name: 'Director', inputs: { TOPIC: 'director jobs' } }] });
    const seen: string[] = [];
    ctx.experimentTaskRun = async (inputs) => { seen.push(inputs.TOPIC); return jobs(OLD); };
    await post(app, `/experiments/${idOf(byChange.headers.location)}/run`);
    await settle();
    expect(seen.sort()).toEqual(['director jobs', 'director jobs', 'staff jobs', 'staff jobs']);
    // Too many runs for one pass.
    const big = await post(app, '/experiments', { ...FORM, repeats: '5', c2_kind: 'model', c2_v1_name: 'a', c2_v2_name: 'b', c2_v3_name: 'c', c2_v4_name: 'd' });
    expect(big.text).toContain('40 runs a pass; 36 at most, since each is the whole agent.');
    expect(big.text).toContain('data-exp-open="6"');
  });

  it('has a model judge each result without telling it the version, and keeps only a usable answer', async () => {
    const app = await makeApp();
    finder();
    const id = idOf((await post(app, '/experiments', { ...FORM, repeats: '1', j1_name: 'On topic', j1_rubric: 'Every job is a staff engineer role.' })).headers.location);
    expect(decodeURIComponent((await post(app, '/experiments', { ...FORM, repeats: '1', j1_rubric: 'x' })).headers.location)).toContain('a pass runs Job finder 2 times');
    ctx.experimentTaskRun = async (_i, at) => jobs(at.conditionId === 'old' ? OLD : NEW);
    const judged: Array<Record<string, string>> = [];
    let bad = 1;
    ctx.experimentJudgeRun = async (inputs) => {
      judged.push(inputs);
      if (bad) { bad--; return '<score>{"score": 0.9, "reason": "Fine."}</score>'; }
      return `<score>${JSON.stringify({ score: JSON.parse(inputs.RESULT)[1].title === 'Role B' ? 0.25 : 1, reason: 'The second one is off topic.', cites: [2] })}</score>`;
    };
    await post(app, `/experiments/${id}/run`);
    await settle();
    // The judge sees the rubric, the ask and the items; nothing naming the version.
    expect(Object.keys(judged[0]).sort()).toEqual(['ASK', 'ERRORS', 'RESULT', 'RUBRIC']);
    expect(judged[0].ASK).toBe('TOPIC: staff engineer jobs');
    expect(JSON.parse(judged[0].RESULT)[0]).toEqual({ n: 1, title: 'Role A', facts: { Company: 'Acme' }, link: 'https://jobs.example/role-a' });
    expect(JSON.stringify(judged)).not.toMatch(/"Old"|"New"|version/i);
    expect(judged.some((j) => j.ERRORS.includes('It cites no item.'))).toBe(true);
    const s = ExperimentStore.fromHandle(runStore.databaseHandle());
    expect(s.scores(s.passes(id)[0].id).map((x) => x.value).sort()).toEqual([0.25, 1]);
    const page = (await get(app, `/experiments/${id}`)).text;
    expect(page).toContain('<th scope="col" class="exp-n">On topic</th>');
    expect(page).toContain('<strong>On topic:</strong> 25%. The second one is off topic.');
    expect(page).toContain('judged: “Every job is a staff engineer role.”');
  });

  it('is told to sua in its page\'s words, in full when a thread links or names it', async () => {
    const app = await makeApp();
    finder();
    const { experimentsForTriage, experimentsLinked } = await import('../lib/experiment-notebook.js');
    expect(experimentsForTriage(ctx)).toBe('[]');
    const id = idOf((await post(app, '/experiments', FORM)).headers.location);
    expect(JSON.parse(experimentsForTriage(ctx))).toMatchObject([{ id, stands: 'not run yet', runs: 'job-finder', changes: ['Build: Old | New'], link: `/experiments/${id}` }]);
    ctx.experimentTaskRun = async (_i, at) => jobs(at.conditionId === 'old' ? OLD : NEW);
    await post(app, `/experiments/${id}/run`);
    await settle();
    const told = JSON.parse(experimentsForTriage(ctx)) as Array<Record<string, unknown>>;
    expect(told[0]).toMatchObject({ stands: '4 of 4 runs', restsOn: '2 versions, 2 runs of each. It holds for this ask, when it was run.' });
    expect(String(told[0].found)).toMatch(/^Build changed what it produced, beyond run-to-run variation\./);
    expect(experimentsLinked(ctx, ['How are things?'], ['How are things?'])).toBe('');
    const read = experimentsLinked(ctx, ['Which jobs did only the new one find?', `See [it](/experiments/${id})`], []);
    expect(read).toContain('## What each version found');
    expect(read).toContain('- Role E: Old: not found; New: all 2, place 2');
    expect(experimentsLinked(ctx, ['[Set one up](/experiments/new?question=x)'], [])).toBe('');
  });

  it('runs a whole notebook as a fresh copy for each version, unattended, and compares what each copy is left with', async () => {
    const app = await makeApp();
    const nbs = NotebookStore.fromHandle(runStore.databaseHandle());
    const src = nbs.create({ title: 'Find a PM job', statement: 'A senior PM job.', params: ['anywhere'], criteria: [] });
    nbs.setFields(src.id, [{ key: 'company', label: 'Company', type: 'text' }, { key: 'posting_url', label: 'Posting', type: 'url', role: 'link' }]);
    nbs.markSetup(src.id);
    nbs.setSteps(src.id, [{ title: 'Find 2 roles', kind: 'find', target: 2 }, { title: 'Pick one', kind: 'decide', target: 1 }]);
    const srcSteps = nbs.get(src.id)!.steps!;

    // The setup page offers it, with the steps sua runs and where a copy stops.
    const { testableNotebooks } = await import('../lib/experiment-runner.js');
    expect(testableNotebooks(ctx)).toMatchObject([{ id: src.id, steps: [{ id: srcSteps[0].id, title: 'Find 2 roles' }], stopsAt: 'Pick one' }]);
    const page = await request(app).get('/experiments/new').set('Cookie', COOKIE).set('Host', `127.0.0.1:${PORT}`);
    expect(page.text).toContain(`value="notebook:${src.id}"`);
    expect(page.text).toContain('Its limits and checks');

    // The finder stand-in: what it finds depends on the copy's limits; "remote only" finds one short of the goal.
    const job = (n: string) => ({ kind: 'option', title: `PM at ${n}`, data: { company: n, posting_url: `https://jobs.example.com/${n.toLowerCase()}` }, fingerprint: `https://jobs.example.com/${n.toLowerCase()}` });
    const asked: string[] = [];
    ctx.notebookFinderRun = async (inputs) => {
      const all = JSON.stringify(inputs);
      asked.push(all);
      return `<notebook>${JSON.stringify({ entries: all.includes('remote only') ? [job('Remoteco')] : [job('Acme'), job('Globex')] })}</notebook>`;
    };

    const made = await post(app, '/experiments', {
      question: 'Does remote only change what it finds?', agent: `notebook:${src.id}`, repeats: '2',
      c1_kind: 'setup', c1_name: 'Limits', c1_v1_name: 'Anywhere', c1_v1_params: 'anywhere', c1_v2_name: 'Remote', c1_v2_params: 'remote only',
    });
    expect(made.status).toBe(303);
    const id = idOf(made.headers.location);
    const store = ExperimentStore.fromHandle(runStore.databaseHandle());
    expect(store.get(id)).toMatchObject({ task: { agentId: '', notebookId: src.id, title: 'Find a PM job' }, factors: [{ levels: [{ params: ['anywhere'], checks: [] }, { params: ['remote only'], checks: [] }] }] });

    expect((await post(app, `/experiments/${id}/run`)).status).toBe(303);
    for (const st of ctx.experimentPasses?.values() ?? []) await st.done;
    const pass = store.passes(id, 1)[0];
    const cells = store.cells(pass.id);
    expect(cells.map((c) => c.status)).toEqual(['done', 'done', 'done', 'done']);
    const of = (cond: string) => cells.filter((c) => c.conditionId.startsWith(cond)).map((c) => c.items!.map((i) => i.title));
    expect(of('anywhere')).toEqual([['PM at Acme', 'PM at Globex'], ['PM at Acme', 'PM at Globex']]);
    expect(of('remote')).toEqual([['PM at Remoteco'], ['PM at Remoteco']]);
    // A step that stopped short moved on with what it had, and the cell says so.
    expect(cells.find((c) => c.conditionId.startsWith('remote'))!.note).toContain('moved on');
    // Each copy is kept, archived and marked as the experiment's; none shows in a list, none has a conversation.
    for (const c of cells) {
      const copy = nbs.get(c.notebookId!)!;
      expect(copy).toMatchObject({ experimentRun: { experimentId: id }, params: [c.conditionId.startsWith('remote') ? 'remote only' : 'anywhere'] });
      expect(copy.archivedAt).toBeTruthy();
      expect(copy.conversationId).toBeUndefined();
      // It stopped before the step that is yours.
      expect(copy.steps!.map((x) => x.status)).toEqual(['done', 'todo']);
    }
    expect(nbs.list({ archived: 'include' }).map((n) => n.id)).toEqual([src.id]);
    expect(nbs.list({ archived: 'include', experimentRuns: true })).toHaveLength(5);
    expect(ctx.inboxStore!.list({}).filter((t) => t.title.startsWith('Notebook:'))).toHaveLength(0);
    // The notebook itself is untouched.
    expect(nbs.entries(src.id, 100).filter((x) => x.kind === 'option')).toHaveLength(0);
    expect(nbs.get(src.id)!.steps!.map((x) => x.status)).toEqual(srcSteps.map((x) => x.status));

    const detail = await request(app).get(`/experiments/${id}`).set('Cookie', COOKIE).set('Host', `127.0.0.1:${PORT}`);
    expect(detail.text).toContain('Limits changed what it produced');
    expect(detail.text).toContain('A fresh copy of the notebook');
    expect(detail.text).toContain('its copy</a>');

    // A version has to fit the notebook: a step it doesn't have is refused, back on the changes.
    const bad = await post(app, '/experiments', { question: 'q', agent: `notebook:${src.id}`, c1_kind: 'step', c1_step: 'nope', c1_v1_name: 'As is', c1_v2_name: 'Other', c1_v2_agent: 'some-agent' });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('has no step');
    // Too many copies for a pass.
    const many = await post(app, '/experiments', { question: 'q', agent: `notebook:${src.id}`, repeats: '5', c1_kind: 'setup', c1_v1_name: 'A', c1_v1_params: 'a', c1_v2_name: 'B', c1_v2_params: 'b', c1_v3_name: 'C', c1_v3_params: 'c' });
    expect(many.status).toBe(400);
    expect(many.text).toContain('copies of the notebook');
  });
});
