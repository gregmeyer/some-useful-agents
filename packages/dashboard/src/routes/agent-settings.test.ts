import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  DashboardsStore,
  LocalProvider,
  MemorySecretsStore,
  PacksStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3996;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp(opts: { schedule?: string; allowHighFrequency?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'sua-agent-settings-'));
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

  const ctx: DashboardContext = {
    token: TOKEN,
    allowlist: buildLoopbackAllowlist(PORT),
    port: PORT,
    provider,
    runStore,
    agentStore,
    loadAgents: () => loadAgents({ directories: [agentsDir] }),
    secretsStore,
    secretsSession: new MemorySecretsSession({ backing: secretsStore }),
    tokenPath: join(dir, 'mcp-token'),
    retentionDays: 30,
    dbPath,
    secretsPath: join(dir, 'secrets.enc'),
    rotateToken: () => 'r'.repeat(64),
    packsStore,
    dashboardsStore,
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  };

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  if (provider) {
    const start = Date.now();
    while ((provider as unknown as { running?: { size: number } }).running?.size && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await provider.shutdown();
  }
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { packsStore?.close(); } catch { /* ignore */ }
  try { dashboardsStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});


const FIELDS = 'provider,model,schedule,runOn,pulseVisible,dashboardVisible,mcp,inboxRunnable,imgSrc';
/** The page as it posts with nothing changed. */
const unchanged = { _fields: FIELDS, provider: '', model: '', schedule: '', runOn: '', pulseVisible: '1', dashboardVisible: '1', imgSrc: '' };

function post(app: Awaited<ReturnType<typeof makeApp>>, body: Record<string, string>, ajax = false) {
  const r = request(app).post('/agents/sched-agent/settings')
    .set('Host', `127.0.0.1:${PORT}`).set('Origin', `http://127.0.0.1:${PORT}`).set('Cookie', COOKIE)
    .type('form').send(body);
  return ajax ? r.set('X-Requested-With', 'fetch') : r;
}

describe('POST /agents/:id/settings', () => {
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
