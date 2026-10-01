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
import { buildInlineActionWidgets } from './inbox-widgets.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3991;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
let dir = '';
let ctx: DashboardContext;
let provider: LocalProvider;

const VIEW = {
  components: [
    { id: 'root', component: 'Column', children: ['price'] },
    { id: 'price', component: 'Metric', label: 'Best price', value: { path: '/outputs/price' } },
  ],
};
const model: SpawnNodeFn = async (node) => ({
  result: node.id === 'design' ? 'not a view at all' : '{"price":"$89"}', exitCode: 0,
});

async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'sua-a2ui-views-'));
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
  const add = (a: Record<string, unknown>) => ctx.agentStore.createAgent({ status: 'active', source: 'local', mcp: false, ...a } as never, 'cli');
  add({ id: 'gauge', name: 'Price gauge', nodes: [{ id: 'answer', type: 'llm-prompt', prompt: 'x' }], view: VIEW });
  add({ id: 'gen', name: 'Generated', nodes: [{ id: 'design', type: 'llm-prompt', prompt: 'x' }], view: { from: 'design' },
    outputWidget: { type: 'raw', fields: [] } });
  const runOf = async (id: string) => executeAgentDag(ctx.agentStore.getAgent(id) as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });
  return { app: buildDashboardApp(ctx), gauge: await runOf('gauge'), gen: await runOf('gen') };
}

afterEach(async () => {
  await provider?.shutdown();
  try { ctx.runStore.close(); ctx.agentStore.close(); ctx.inboxStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});
const get = (app: Parameters<typeof request>[0], p: string) => request(app).get(p).set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);

describe('A2UI views across the dashboard', () => {
  it('the run page shows the view; an invalid generated view says why and falls back to the widget', async () => {
    const { app, gauge, gen } = await setup();
    const page = await get(app, `/runs/${gauge.id}`);
    expect(page.text).toContain(`data-surface-id="run-${gauge.id}"`);
    expect(page.text).toContain('"price":"$89"');
    const bad = await get(app, `/runs/${gen.id}`);
    expect(bad.text).toContain("couldn't be shown");
    expect(bad.text).not.toContain('data-a2ui-surface');
  });

  it('an agent with only a view gets a Pulse tile drawn from it, and the tile refresh returns it too', async () => {
    const { app } = await setup();
    const pulse = await get(app, '/pulse');
    expect(pulse.text).toContain('data-surface-id="tile-gauge"');
    const tile = await get(app, '/pulse/tile/gauge');
    expect(tile.status).toBe(200);
    expect(tile.text).toContain('data-surface-id="tile-gauge"');
  });

  it('an inbox action that ran an agent with a view shows the view inline', async () => {
    const { gauge } = await setup();
    const m = ctx.inboxStore!.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r = ctx.inboxStore!.addResponse(m.id, 'action', 'ran gauge', JSON.stringify({ kind: 'action', status: 'completed', agentId: 'gauge', runId: gauge.id, inputs: {} }));
    const widgets = buildInlineActionWidgets(ctx, m.id, ctx.inboxStore!.listResponses(m.id));
    expect(String(widgets[r.id])).toContain(`data-surface-id="inbox-${m.id}-${gauge.id}"`);
  });
});

describe('A2UI is the default widget renderer', () => {
  it('draws existing widgets with A2UI unless Settings → Appearance switches back to the previous renderer', async () => {
    const { app } = await setup();
    ctx.agentStore.createAgent({ id: 'stars', name: 'Stars', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'count', type: 'llm-prompt', prompt: 'x' }],
      signal: { title: 'Stars', template: 'metric', mapping: { value: 'price' } } } as never, 'cli');
    const run = await executeAgentDag(ctx.agentStore.getAgent('stars') as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });
    expect(run.status).toBe('completed');
    const post = (body: string) => request(app).post('/settings/appearance/a2ui').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE).type('form').send(body);

    let tile = await get(app, '/pulse/tile/stars');
    expect(tile.text).toContain('data-surface-id="tile-stars"');
    expect(tile.text).toContain('"value":"$89"');
    expect((await get(app, '/settings/appearance')).text).toMatch(/name="enabled" value="1" checked/);
    expect((await post('')).status).toBe(303);
    tile = await get(app, '/pulse/tile/stars');
    expect(tile.text).not.toContain('data-surface-id="tile-stars"');
    await post('enabled=1');
    tile = await get(app, '/pulse/tile/stars');
    expect(tile.text).toContain('data-surface-id="tile-stars"');
  });

  it('keeps a widget with a capture-image control on the previous renderer, and puts a copy control above A2UI widgets', async () => {
    const { app } = await setup();
    for (const [id, control] of [['snap', 'capture-image'], ['clip', 'copy']] as const) {
      ctx.agentStore.createAgent({ id, name: id, status: 'active', source: 'local', mcp: false,
        nodes: [{ id: 'n', type: 'llm-prompt', prompt: 'x' }],
        outputWidget: { type: 'key-value', fields: [{ name: 'price', type: 'text' }], controls: [{ type: control }] } } as never, 'cli');
      await executeAgentDag(ctx.agentStore.getAgent(id) as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });
    }
    const runOf = (agent: string) => ctx.runStore.listRuns({ agentName: agent, limit: 1 })[0].id;
    const snap = await get(app, `/runs/${runOf('snap')}`);
    expect(snap.text).not.toContain('data-a2ui-surface');
    expect(snap.text).toContain('data-widget-capture');
    const clip = await get(app, `/runs/${runOf('clip')}`);
    expect(clip.text).toMatch(/data-widget-control-row="">\s*<button[^>]*data-widget-copy[\s\S]*?<\/div><div class="a2ui-host"/);
  });
});
