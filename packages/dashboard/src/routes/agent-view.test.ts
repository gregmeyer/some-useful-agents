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
