import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import {
  InboxStore,
  executeAgentDag,
  type Agent,
  type SpawnNodeFn,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../session.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';
import { buildInlineActionWidgets } from './inbox-widgets.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3991;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;
let ctx: DashboardContext;
let t: TestContext | undefined;

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
  t = await createTestContext({ port: PORT, prefix: 'sua-a2ui-views-', extra: ({ dbPath }) => ({
    inboxStore: new InboxStore(dbPath),
  }) });
  ({ ctx } = t);
  const add = (a: Record<string, unknown>) => ctx.agentStore.createAgent({ status: 'active', source: 'local', mcp: false, ...a } as never, 'cli');
  add({ id: 'gauge', name: 'Price gauge', nodes: [{ id: 'answer', type: 'llm-prompt', prompt: 'x' }], view: VIEW });
  add({ id: 'gen', name: 'Generated', nodes: [{ id: 'design', type: 'llm-prompt', prompt: 'x' }], view: { from: 'design' },
    outputWidget: { type: 'raw', fields: [] } });
  const runOf = async (id: string) => executeAgentDag(ctx.agentStore.getAgent(id) as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });
  return { app: buildDashboardApp(ctx), gauge: await runOf('gauge'), gen: await runOf('gen') };
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
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

  it('a view trend shows every run so far, on the run page and the Pulse tile', async () => {
    const { app } = await setup();
    ctx.agentStore.createAgent({ id: 'trendy', name: 'Trendy', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'count', type: 'llm-prompt', prompt: 'x' }],
      view: { components: [{ id: 'root', component: 'Sparkline', label: 'Price', values: { path: '/series/price' } }] } } as never, 'cli');
    let last;
    for (let i = 0; i < 3; i++) {
      last = await executeAgentDag(ctx.agentStore.getAgent('trendy') as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });
      await new Promise((r) => setTimeout(r, 5)); // distinct startedAt
    }
    expect((await get(app, `/runs/${last!.id}`)).text).toContain('"series":{"price":[89,89,89]}');
    expect((await get(app, '/boards/tile/trendy.json?board=pulse')).text).toContain('"series":{"price":[89,89,89]}');
  });

  it('an agent with only a view gets a Pulse tile drawn from it, and its tile refresh returns it too', async () => {
    const { app } = await setup();
    const pulse = await get(app, '/pulse/agents');
    expect(pulse.text).toContain('"surfaceId":"tile-gauge"'); // the canvas tile registry carries the view
    const tile = await get(app, '/boards/tile/gauge.json?board=pulse');
    expect(tile.status).toBe(200);
    expect(tile.text).toContain('"surfaceId":"tile-gauge"');
  });

  it('an inbox action that ran an agent with a view shows the view inline', async () => {
    const { gauge } = await setup();
    const m = ctx.inboxStore!.add({ priority: 'medium', source: 'manual', title: 't', body: 'b' });
    const r = ctx.inboxStore!.addResponse(m.id, 'action', 'ran gauge', JSON.stringify({ kind: 'action', status: 'completed', agentId: 'gauge', runId: gauge.id, inputs: {} }));
    const widgets = buildInlineActionWidgets(ctx, m.id, ctx.inboxStore!.listResponses(m.id));
    expect(String(widgets[r.id])).toContain(`data-surface-id="inbox-${m.id}-${gauge.id}"`);
  });
});

describe('the sua catalog document (ADR-0085)', () => {
  it('is served where its catalogId points, as A2UI v1.0 catalog JSON', async () => {
    const { app } = await setup();
    const res = await get(app, '/a2ui/catalogs/sua/v1.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ catalogId: 'https://some-useful-agents.dev/a2ui/catalogs/sua/v1.json', protocolVersion: '1.0', title: 'sua' });
    expect(Object.keys(res.body.components)).toContain('Callout');
  });
});

describe('A2UI is the default widget renderer', () => {
  it('draws existing widgets with A2UI, and the old renderer switch is gone', async () => {
    const { app } = await setup();
    ctx.agentStore.createAgent({ id: 'stars', name: 'Stars', status: 'active', source: 'local', mcp: false,
      nodes: [{ id: 'count', type: 'llm-prompt', prompt: 'x' }],
      signal: { title: 'Stars', template: 'metric', mapping: { value: 'price' } } } as never, 'cli');
    const run = await executeAgentDag(ctx.agentStore.getAgent('stars') as Agent, { triggeredBy: 'cli' }, { runStore: ctx.runStore, spawnNode: model });
    expect(run.status).toBe('completed');
    const tile = await get(app, '/boards/tile/stars.json?board=pulse');
    expect(tile.text).toContain('"surfaceId":"tile-stars"');
    expect(tile.text).toContain('"value":"$89"');
    const appearance = (await get(app, '/settings/appearance')).text;
    expect(appearance).not.toContain('/settings/appearance/a2ui');
    expect(appearance).not.toContain('/settings/appearance/boards');
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
