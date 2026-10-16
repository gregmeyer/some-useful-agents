import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  InboxStore,
  LocalProvider,
  MemorySecretsStore,
  RunStore,
  buildLoopbackAllowlist,
  executeAgentDag,
  loadAgents,
  type Agent,
  type SpawnNodeFn,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { parseProposedActions } from './inbox-plan.js';
import { executeViewRedesign } from './inbox-engine.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3992;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
let dir = '';
let ctx: DashboardContext;
let provider: LocalProvider;

const model: SpawnNodeFn = async () => ({ result: '{"price":"$89","store":"Corner shop","items":[{"name":"Lamp","qty":2}]}', exitCode: 0 });

async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-view-editor-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  const secretsStore = new MemorySecretsStore();
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  ctx = {
    token: TOKEN, allowlist: buildLoopbackAllowlist(PORT), port: PORT, provider,
    runStore: new RunStore(dbPath), agentStore: new AgentStore(dbPath), inboxStore: new InboxStore(dbPath),
    loadAgents: () => loadAgents({ directories: [agentsDir] }), secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }), tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30, dbPath, secretsPath: join(dir, 'secrets.enc'), rotateToken: () => 'r'.repeat(64),
    allowUntrustedShell: new Set(), activeRuns: new Map(), inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(), dataDir: dir, dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as DashboardContext;
  ctx.agentStore.createAgent({ id: 'shop', name: 'Shop', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'look', type: 'llm-prompt', prompt: 'x' }],
    outputWidget: { type: 'key-value', fields: [{ name: 'price', type: 'text', label: 'Best price' }] } } as never, 'cli');
  return buildDashboardApp(ctx);
}

const runShop = () => executeAgentDag(ctx.agentStore.getAgent('shop') as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });

afterEach(async () => {
  await provider?.shutdown();
  try { ctx.runStore.close(); ctx.agentStore.close(); ctx.inboxStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
const post = (app: Parameters<typeof request>[0], p: string, body: Record<string, string>) =>
  request(app).post(p).set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);

const GOOD = `- { id: root, component: Column, children: [p] }
- { id: p, component: Metric, label: Price, value: { path: /outputs/price } }`;

describe('the View editor', () => {
  it('starts an agent with no view from its last run\'s outputs, labelled by its old widget, and previews it', async () => {
    const app = await setup();
    await runShop();
    const page = await get(app, '/agents/shop/view');
    expect(page.status).toBe(200);
    expect(page.text).toContain('It shows runs with its output widget now');
    expect(page.text).toContain('label: Best price');          // the widget's label carried over
    expect(page.text).toContain('component: Table');           // items became a table
    expect(page.text).toContain('data-surface-id="view-preview"');
    expect(page.text).toContain('/outputs/store');             // the bindable paths list
    expect(page.text).toContain('Save as v2');
    expect(page.text).not.toContain('Remove view');
  });

  it('previews as you type: errors for bad YAML or components, a surface for a good view', async () => {
    const app = await setup();
    await runShop();
    let res = await post(app, '/agents/shop/view/preview', { text: '- { id: root' });
    expect(res.body.ok).toBe(false);
    expect(res.body.errors[0]).toContain('Not valid YAML');
    res = await post(app, '/agents/shop/view/preview', { text: '- { id: root, component: Nope }' });
    expect(res.body.ok).toBe(false);
    expect(res.body.errors[0]).toBe('"Nope" isn\'t a component sua knows. The list is under sua components, below.');
    res = await post(app, '/agents/shop/view/preview', { text: GOOD });
    expect(res.body.ok).toBe(true);
    expect(res.body.html).toContain('"price":"$89"');
  });

  it('saves the view as a new version, refuses a stale or invalid save, and removes it', async () => {
    const app = await setup();
    await runShop();
    let res = await post(app, '/agents/shop/view', { text: GOOD, baseVersion: '1' });
    expect(decodeURIComponent(res.headers.location)).toContain('Saved as v2');
    const saved = ctx.agentStore.getAgent('shop')!;
    expect(saved.view && 'components' in saved.view ? saved.view.components.map((c) => c.id) : []).toEqual(['root', 'p']);
    expect(saved.outputWidget).toBeDefined(); // kept, unused
    res = await post(app, '/agents/shop/view', { text: GOOD, baseVersion: '1' });
    expect(decodeURIComponent(res.headers.location)).toContain('changed since you opened the editor');
    res = await post(app, '/agents/shop/view', { text: 'nope: 1', baseVersion: '2' });
    expect(decodeURIComponent(res.headers.location)).toContain('Not saved.');
    expect(ctx.agentStore.getAgent('shop')!.version).toBe(2);
    const page = await get(app, '/agents/shop/view');
    expect(page.text).toContain('This is its view, from v2.');
    expect(page.text).toContain('data-confirm-modal="Runs go back to its output widget');
    res = await post(app, '/agents/shop/view/remove', { baseVersion: '2' });
    expect(decodeURIComponent(res.headers.location)).toContain('Removed the view (v3)');
    expect(ctx.agentStore.getAgent('shop')!.view).toBeUndefined();
  });

  it('works before the agent has run, and Settings links to it', async () => {
    const app = await setup();
    const page = await get(app, '/agents/shop/view');
    expect(page.text).toContain('Run the agent once to preview');
    expect((await get(app, '/agents/shop/config')).text).toContain('href="/agents/shop/view"');
  });
});

describe('Redesign with sua', () => {
  const settle = async () => { for (let i = 0; i < 50 && ctx.viewDesignerRunning?.size; i++) await new Promise((r) => setTimeout(r, 10)); };

  it('asks the designer with the view, real data and catalog, retries once with the errors, and shows both views', async () => {
    const app = await setup();
    await runShop();
    const seen: Array<Record<string, string>> = [];
    ctx.viewDesignerRun = async (inputs) => {
      seen.push(inputs);
      return seen.length === 1
        ? '<view>{"components":[{"id":"root","component":"Nope"}]}</view>'
        : '<view>{"why":"Leads with the price.","components":[{"id":"root","component":"Metric","label":"Price","value":{"path":"/outputs/price"}}]}</view>';
    };
    const res = await post(app, '/agents/shop/view/redesign', { request: 'lead with the price' });
    expect(decodeURIComponent(res.headers.location)).toContain('sua is redesigning the view');
    await settle();
    expect(seen).toHaveLength(2);
    expect(seen[0].REQUEST).toBe('lead with the price');
    expect(seen[0].DATA).toContain('"price":"$89"');
    expect(seen[0].CATALOG).toContain('Sparkline');
    expect(seen[0].CURRENT).toContain('"component":"Table"'); // the starter, since it has no view
    expect(seen[1].FIX).toContain('Nope');
    expect((await get(app, '/agents/shop/view/proposal.json')).body).toEqual({ status: 'ready' });
    const page = await get(app, '/agents/shop/view');
    expect(page.text).toContain("sua's proposal");
    expect(page.text).toContain('Leads with the price.');
    expect(page.text).toContain('data-surface-id="view-now"');
    expect(page.text).toContain('data-surface-id="view-proposed"');
    expect(page.text).toContain('Use this (save as v2)');
  });

  it('uses the proposal as a new version, or discards it', async () => {
    const app = await setup();
    await runShop();
    ctx.viewDesignerRun = async () => '<view>{"components":[{"id":"root","component":"Metric","label":"Price","value":{"path":"/outputs/price"}}]}</view>';
    await post(app, '/agents/shop/view/redesign', {});
    await settle();
    let res = await post(app, '/agents/shop/view/proposal/use', { baseVersion: '1' });
    expect(decodeURIComponent(res.headers.location)).toContain("Saved sua's view as v2");
    const v = ctx.agentStore.getAgent('shop')!.view;
    expect(v && 'components' in v ? v.components[0].component : '').toBe('Metric');
    expect((await get(app, '/agents/shop/view/proposal.json')).body).toEqual({ status: 'none' });

    await post(app, '/agents/shop/view/redesign', {});
    await settle();
    res = await post(app, '/agents/shop/view/proposal/discard', {});
    expect(decodeURIComponent(res.headers.location)).toContain('Discarded');
    expect((await get(app, '/agents/shop/view/proposal.json')).body).toEqual({ status: 'none' });
  });

  it('says why when the designer never produces a valid view', async () => {
    const app = await setup();
    await runShop();
    ctx.viewDesignerRun = async () => 'no view here';
    await post(app, '/agents/shop/view/redesign', {});
    await settle();
    const page = await get(app, '/agents/shop/view');
    expect(page.text.replace(/&#39;/g, "'")).toContain("sua's redesign didn't work out: sua didn't come back with a view.</p>");
    expect(page.text).toContain('Try again');
  });
});

describe('Ask sua: view-redesign', () => {
  it('parses a view-redesign action (AGENT_ID required) and runs it without approval', async () => {
    const ok = parseProposedActions([{ type: 'view-redesign', rationale: 'r', inputs: { AGENT_ID: 'shop', REQUEST: 'lead with the price' } }], []);
    expect(ok.accepted[0]).toMatchObject({ agentId: 'view-redesign', effect: 'read', inputs: { AGENT_ID: 'shop' } });
    expect(parseProposedActions([{ type: 'view-redesign', inputs: {} }], []).rejected[0].reason).toContain('AGENT_ID');

    await setup();
    await runShop();
    let asked = '';
    ctx.viewDesignerRun = async (inputs) => { asked = inputs.REQUEST; return '<view>{"components":[{"id":"root","component":"Metric","label":"Price","value":{"path":"/outputs/price"}}]}</view>'; };
    const out = executeViewRedesign(ctx, ok.accepted[0]);
    expect(out.status).toBe('completed');
    expect(out.summary).toContain('/agents/shop/view#redesign');
    for (let i = 0; i < 50 && ctx.viewDesignerRunning?.size; i++) await new Promise((r) => setTimeout(r, 10));
    expect(asked).toBe('lead with the price');
    expect(ctx.agentStore.getAgent('shop')!.view).toBeUndefined(); // nothing changes until it's used
    expect(executeViewRedesign(ctx, { ...ok.accepted[0], inputs: { AGENT_ID: 'nope' } }).status).toBe('failed');
  });
});

describe('the agent Overview leads with the latest result', () => {
  it('shows no result before a run, then the latest result, run dots and the ⋯ menu', async () => {
    const app = await setup();
    let page = (await get(app, '/agents/shop')).text;
    expect(page).toContain('No result yet. Run it to see what it makes.');
    expect(page).toContain('No runs yet.');
    await runShop();
    page = (await get(app, '/agents/shop')).text;
    expect(page).toContain('Latest result');
    expect(page).toContain('data-surface-id="latest-shop"');
    expect(page).toContain('"$89"');
    expect(page).toContain('run-dot run-dot--completed');
    expect(page).toContain('1 of 1 finished');
    expect(page).toContain('Only when asked');
    expect(page).toContain('href="/agents/shop/view#redesign"');
    expect(page).toContain('href="/agents/shop/view?redesign=1#redesign"'); // ✎ Change how this looks, on the result
    expect(page).toContain('How it works');
    expect(page).not.toContain('Recent runs');
  });

  it('says when the newest run failed, above the last one that finished', async () => {
    const app = await setup();
    await runShop();
    ctx.runStore.createRun({ id: 'later-fail', agentName: 'shop', status: 'failed', startedAt: new Date(Date.now() + 1000).toISOString(), triggeredBy: 'cli', error: 'HTTP 503 from the store\nstack…' } as never);
    const page = (await get(app, '/agents/shop')).text;
    expect(page).toContain('<strong>The last run failed</strong>');
    expect(page).toContain('HTTP 503 from the store');
    expect(page).not.toContain('stack…');
    expect(page).toContain('<a href="/runs/later-fail">Open the run →</a>');
    expect(page).toContain('action="/agents/shop/ask-fix" data-ask-fix');
    expect(page).toContain('>Last good result</h2>');
    expect(page).toContain('Below is what it made the last time it finished.');
    expect(page).toContain('run-dot run-dot--failed');
  });

  it('a JSON answer with no widget reads as facts, and an agent others call lists its last results', async () => {
    const app = await setup();
    ctx.agentStore.createAgent({ id: 'page-facts', name: 'Page Facts', status: 'active', source: 'local', mcp: false,
      inputs: { URL: { type: 'string' } },
      nodes: [{ id: 'read', type: 'llm-prompt', prompt: 'x' }] } as never, 'cli');
    ctx.agentStore.createAgent({ id: 'caller', name: 'Caller', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'call', type: 'agent-invoke', agentInvokeConfig: { agentId: 'page-facts', inputs: { URL: 'x' } } }] } as never, 'cli');
    const agent = ctx.agentStore.getAgent('page-facts') as Agent;
    const said = ['{"url": "https://shop.example/item/1", "status": "ok", "price": 40}', '{"url": "", "status": "blocked"}'];
    for (const [i, out] of said.entries()) {
      await executeAgentDag(agent, { triggeredBy: 'cli', inputs: { URL: i === 0 ? 'https://shop.example/item/1' : '' } }, { runStore: ctx.runStore, spawnNode: async () => ({ result: out, exitCode: 0 }) });
      await new Promise((r) => setTimeout(r, 5));
    }
    const page = (await get(app, '/agents/page-facts')).text;
    // Labelled facts (an empty one says so), with the raw text folded away.
    expect(page).toContain('"label":"Status","value":"blocked"');
    expect(page).toContain('"label":"Url","value":"(empty)"');
    expect(page).toContain('<summary>Raw output</summary>');
    // Its last results, input → answer, open because the latest is a short JSON answer.
    expect(page).toContain('<details class="agent-recent" open>');
    expect(page).toContain('<summary>Its last 2 results</summary>');
    expect(page).toContain('https://shop.example/item/1</span>');
    expect(page).toContain('url: https://shop.example/item/1 · status: ok · price: 40');
    expect(page).toContain('<span class="agent-recent__out">status: blocked</span>');
  });

  it('shows what the run said when none of the widget\'s fields are in it', async () => {
    const app = await setup();
    ctx.agentStore.createAgent({ id: 'chatty', name: 'Chatty', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'say', type: 'llm-prompt', prompt: 'x' }],
      outputWidget: { type: 'raw', fields: [{ name: 'missing', type: 'text' }] } } as never, 'cli');
    await executeAgentDag(ctx.agentStore.getAgent('chatty') as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: async () => ({ result: 'Found 2 roles at Rula.', exitCode: 0 }) });
    const page = (await get(app, '/agents/chatty')).text;
    expect(page).toContain('Found 2 roles at Rula.');
  });
});

describe('the Overview diagram while a run is in progress', () => {
  it('opens the diagram on the running step, and live.json follows it until it ends', async () => {
    const app = await setup();
    const startedAt = new Date().toISOString();
    ctx.runStore.createRun({ id: 'live-1', agentName: 'shop', status: 'running', startedAt, triggeredBy: 'cli' } as never);
    ctx.runStore.createNodeExecution({ runId: 'live-1', nodeId: 'look', workflowVersion: 1, status: 'running', startedAt } as never);
    const page = (await get(app, '/agents/shop')).text;
    expect(page).toContain('data-agent-live-run="live-1"');
    expect(page).toMatch(/<details class="agent-how__diagram" open>/);
    expect(page).toContain('Running: look');
    expect(page).toContain('"status":"running"');

    let live = (await get(app, '/agents/shop/live.json?run=live-1')).body;
    expect(live.status).toBe('running');
    expect(live.step).toBe('Running: look');
    expect(JSON.parse(live.dag).elements.find((e: { data: { id: string } }) => e.data.id === 'look').data.status).toBe('running');

    ctx.runStore.updateRun('live-1', { status: 'completed', completedAt: new Date().toISOString(), result: '{"price":"$90"}' });
    live = (await get(app, '/agents/shop/live.json?run=live-1')).body;
    expect(live.status).toBe('completed');
    expect((await get(app, '/agents/shop/live.json?run=nope')).status).toBe(404);
    expect((await get(app, '/agents/shop')).text).not.toContain('data-agent-live-run');
  });
});
