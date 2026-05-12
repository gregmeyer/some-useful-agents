import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  DashboardsStore,
  IntegrationsStore,
  LocalProvider,
  MemorySecretsStore,
  PacksStore,
  RunStore,
  buildLoopbackAllowlist,
  createOauthStateStore,
  loadAgents,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';
import { refreshTokenSecretName } from './oauth.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3998;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;
let integrationsStore: IntegrationsStore;
let secretsStore: MemorySecretsStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-oauth-routes-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  integrationsStore = new IntegrationsStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

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
    integrationsStore,
    oauthStateStore: createOauthStateStore(),
    allowUntrustedShell: new Set(),
    activeRuns: new Map(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  };

  return { app: buildDashboardApp(ctx), ctx };
}

afterEach(async () => {
  if (provider) {
    await provider.shutdown();
  }
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { packsStore?.close(); } catch { /* ignore */ }
  try { dashboardsStore?.close(); } catch { /* ignore */ }
  try { integrationsStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('refreshTokenSecretName', () => {
  it('uppercases + sanitises the integration id', () => {
    expect(refreshTokenSecretName('user:gmail-oncall')).toBe('USER_GMAIL_ONCALL__REFRESH_TOKEN');
    expect(refreshTokenSecretName('starter:hi-there')).toBe('STARTER_HI_THERE__REFRESH_TOKEN');
  });
});

describe('POST /settings/integrations/:id/connect', () => {
  it('redirects to Google with state + PKCE challenge when secrets are present', async () => {
    const { app } = await makeApp();
    integrationsStore.upsertIntegration({
      id: 'user:gmail-oncall', packId: null, kind: 'gmail', name: 'Oncall',
      config: { client_id_secret: 'GMAIL_CLIENT_ID', client_secret_secret: 'GMAIL_CLIENT_SECRET' },
      secretRefs: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET'],
    });
    await secretsStore.set('GMAIL_CLIENT_ID', 'cid-value');
    await secretsStore.set('GMAIL_CLIENT_SECRET', 'csec-value');

    const res = await request(app)
      .post('/settings/integrations/user:gmail-oncall/connect')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(res.headers.location).toContain('client_id=cid-value');
    expect(res.headers.location).toContain('code_challenge=');
    expect(res.headers.location).toContain('code_challenge_method=S256');
    expect(res.headers.location).toContain('state=');
    expect(res.headers.location).toContain('access_type=offline');
  });

  it('refuses to start the flow when credentials are missing in the secrets store', async () => {
    const { app } = await makeApp();
    integrationsStore.upsertIntegration({
      id: 'user:gmail-bare', packId: null, kind: 'gmail', name: 'Bare',
      config: { client_id_secret: 'GMAIL_CLIENT_ID', client_secret_secret: 'GMAIL_CLIENT_SECRET' },
      secretRefs: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET'],
    });
    const res = await request(app)
      .post('/settings/integrations/user:gmail-bare/connect')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain('/settings/integrations');
    expect(res.headers.location).toMatch(/Set(\+|%20)GMAIL_CLIENT/);
  });

  it('refuses to connect a non-OAuth kind', async () => {
    const { app } = await makeApp();
    integrationsStore.upsertIntegration({
      id: 'user:slack-oncall', packId: null, kind: 'slack', name: 'Slack',
      config: { webhook_secret: 'SLACK_WEBHOOK' }, secretRefs: ['SLACK_WEBHOOK'],
    });
    const res = await request(app)
      .post('/settings/integrations/user:slack-oncall/connect')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/does(\+|%20)not(\+|%20)support(\+|%20)OAuth/);
  });
});

describe('GET /oauth/callback', () => {
  it('rejects with an error redirect when state is unknown', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/oauth/callback?state=unknown-state&code=anything')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/expired\+or\+state\+unknown/);
  });

  it('surfaces provider-side errors back to the user', async () => {
    const { app } = await makeApp();
    const res = await request(app)
      .get('/oauth/callback?error=access_denied')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/OAuth(\+|%20)denied/);
  });
});

describe('POST /settings/integrations/:id/disconnect', () => {
  it('clears connected state + deletes the persisted refresh token', async () => {
    const { app } = await makeApp();
    const id = 'user:gmail-discon';
    integrationsStore.upsertIntegration({
      id, packId: null, kind: 'gmail', name: 'Disconnect Test',
      config: {
        client_id_secret: 'GMAIL_CLIENT_ID',
        client_secret_secret: 'GMAIL_CLIENT_SECRET',
        refresh_token_secret: 'USER_GMAIL_DISCON__REFRESH_TOKEN',
        connected_account: 'foo@example.com',
        connected_at: Date.now(),
      },
      secretRefs: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'USER_GMAIL_DISCON__REFRESH_TOKEN'],
    });
    await secretsStore.set('USER_GMAIL_DISCON__REFRESH_TOKEN', 'rt-zzz');

    const res = await request(app)
      .post(`/settings/integrations/${id}/disconnect`)
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/Disconnected/);
    expect(await secretsStore.has('USER_GMAIL_DISCON__REFRESH_TOKEN')).toBe(false);
    const after = integrationsStore.getIntegration(id)!;
    expect(after.config.connected_account).toBeUndefined();
    expect(after.config.connected_at).toBeUndefined();
    expect(after.config.refresh_token_secret).toBeUndefined();
    expect(after.secretRefs).not.toContain('USER_GMAIL_DISCON__REFRESH_TOKEN');
  });
});
