import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import {
  AgentStore,
  DashboardsStore,
  PacksStore,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3996;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let agentStore: AgentStore;
let t: TestContext | undefined;

async function makeApp(opts: { schedule?: string; allowHighFrequency?: boolean } = {}) {
  t = await createTestContext({ port: PORT, prefix: 'sua-agent-settings-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath), dashboardsStore: new DashboardsStore(dbPath),
  }) });
  const { ctx } = t;
  agentStore = ctx.agentStore;

  agentStore.createAgent({
    id: 'sched-agent',
    name: 'Sched Agent',
    status: 'active',
    source: 'local',
    mcp: false,
    schedule: opts.schedule,
    allowHighFrequency: opts.allowHighFrequency,
    nodes: [{ id: 'n', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});


const FIELDS = 'provider,model,schedule,runOn,timeoutMinutes,pulseVisible,dashboardVisible,mcp,inboxRunnable,imgSrc';
/** The page as it posts with nothing changed. */
const unchanged = { _fields: FIELDS, provider: '', model: '', schedule: '', runOn: '', timeoutMinutes: '', pulseVisible: '1', dashboardVisible: '1', imgSrc: '' };

function post(app: Awaited<ReturnType<typeof makeApp>>, body: Record<string, string>, ajax = false) {
  const r = request(app).post('/agents/sched-agent/settings')
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE)
    .type('form').send(body);
  return ajax ? r.set('X-Requested-With', 'fetch') : r;
}

describe('POST /agents/:id/settings', () => {
  it('sets a whole-run time limit in minutes, stored as timeoutSec, and clears it', async () => {
    const app = await makeApp();
    const before = agentStore.getAgent('sched-agent')!.version;
    let res = await post(app, { ...unchanged, timeoutMinutes: '15' });
    expect(decodeURIComponent(res.headers.location)).toContain(`Saved as v${String(before + 1)}: Stop a run after.`);
    expect(agentStore.getAgent('sched-agent')!.timeoutSec).toBe(900);
    res = await post(app, { ...unchanged, timeoutMinutes: '15', preview: '1' }, true);
    expect(res.body.changes).toEqual([]);
    res = await post(app, { ...unchanged, timeoutMinutes: 'soon', preview: '1' }, true);
    expect(res.body.errors[0]).toContain("isn't a number of minutes");
    res = await post(app, { ...unchanged, preview: '1' }, true);
    expect(res.body.changes[0]).toMatchObject({ what: 'Stop a run after', before: '15 min', after: 'No limit' });
    await post(app, { ...unchanged });
    expect(agentStore.getAgent('sched-agent')!.timeoutSec).toBeUndefined();
  });

  it('previews the changes in plain words without saving', async () => {
    const app = await makeApp();
    const res = await post(app, { ...unchanged, schedule: '0 9 * * 1-5', mcp: '1', preview: '1' }, true);
    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.versioned).toBe(false);
    expect(res.body.changes.map((c: { what: string }) => c.what)).toEqual(['When it runs', 'Let AI apps call it']);
    expect(res.body.changes[0]).toMatchObject({ before: 'Only when asked' });
    const agent = agentStore.getAgent('sched-agent')!;
    expect(agent.schedule).toBeUndefined();
    expect(agent.mcp).toBe(false);
  });

  it('saves versioned and row-level changes together as one version', async () => {
    const app = await makeApp();
    const before = agentStore.getAgent('sched-agent')!.version;
    const res = await post(app, { ...unchanged, baseVersion: String(before), provider: 'codex', model: 'o3', schedule: '0 8 * * *', pulseVisible: '', imgSrc: 'https://Images.Example.com/x.png' });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.location)).toContain(`Saved as v${String(before + 1)}: Model, When it runs, Show on Pulse, Images from.`);
    const agent = agentStore.getAgent('sched-agent')!;
    expect(agent.version).toBe(before + 1);
    expect(agent).toMatchObject({ provider: 'codex', model: 'o3', schedule: '0 8 * * *', pulseVisible: false });
    expect(agent.permissions?.imgSrc).toEqual(['images.example.com']);
  });

  it('saves row-only changes without a new version', async () => {
    const app = await makeApp();
    const before = agentStore.getAgent('sched-agent')!.version;
    const res = await post(app, { ...unchanged, dashboardVisible: '' });
    expect(decodeURIComponent(res.headers.location)).toContain('Saved: Show in the agents list.');
    const agent = agentStore.getAgent('sched-agent')!;
    expect(agent.version).toBe(before);
    expect(agent.dashboardVisible).toBe(false);
  });

  it('refuses invalid input and saves nothing', async () => {
    const app = await makeApp();
    const res = await post(app, { ...unchanged, schedule: 'every tuesday', mcp: '1', imgSrc: 'not a host!' });
    const flash = decodeURIComponent(res.headers.location);
    expect(flash).toContain("isn't a schedule sua understands");
    expect(flash).toContain('Not a host name');
    expect(agentStore.getAgent('sched-agent')!.mcp).toBe(false);
  });

  it('refuses a versioned save over a newer version', async () => {
    const app = await makeApp();
    const before = agentStore.getAgent('sched-agent')!.version;
    const res = await post(app, { ...unchanged, baseVersion: String(before - 1 || 99), provider: 'codex' }, true);
    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toContain('changed since you opened Settings');
    expect(agentStore.getAgent('sched-agent')!.provider).toBeUndefined();
  });

  it('says so when nothing changed', async () => {
    const app = await makeApp();
    const res = await post(app, unchanged);
    expect(decodeURIComponent(res.headers.location)).toContain('Nothing to save.');
  });

  it('after a rollback, Save names the next free version and saving works', async () => {
    const app = await makeApp();
    const a = agentStore.getAgent('sched-agent')!;
    agentStore.createNewVersion('sched-agent', { ...a, description: 'v2' }, 'cli');
    agentStore.setCurrentVersion('sched-agent', 1);
    const page = await request(app).get('/agents/sched-agent/config').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(page.text).toContain('data-next-version="3"');
    const res = await post(app, { ...unchanged, baseVersion: '1', provider: 'codex' });
    expect(res.status).toBe(303);
    expect(agentStore.getAgent('sched-agent')).toMatchObject({ version: 3, provider: 'codex' });
  });

  it('renders the Settings tab with sections and the batched form', async () => {
    const app = await makeApp({ schedule: '0 9 * * 1-5' });
    const res = await request(app).get('/agents/sched-agent/config').set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('>Settings<');
    for (const id of ['inputs', 'model', 'when', 'where', 'connect', 'access']) expect(res.text).toContain(`id="settings-${id}"`);
    expect(res.text).toContain('action="/agents/sched-agent/settings"');
    expect(res.text).toMatch(/data-cron="0 9 \* \* 1-5" aria-pressed="true"/);
  });
});
