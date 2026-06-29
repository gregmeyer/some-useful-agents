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
import { renderNotFoundPage } from './not-found.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3995;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;

async function makeApp() {
  dir = mkdtempSync(join(tmpdir(), 'sua-not-found-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  const packsStore = new PacksStore(dbPath);
  const dashboardsStore = new DashboardsStore(dbPath);
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
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('renderNotFoundPage', () => {
  it('renders the 404 chrome with suggestions', () => {
    const html = renderNotFoundPage({ path: '/no/such/path' });
    expect(html).toContain('404');
    expect(html).toContain('/no/such/path');
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/"'); // Home (was /pulse before the collapse)
    expect(html).toContain('href="/packs"');
    expect(html).toContain('topbar'); // wrapped in standard layout
  });

  it('uses the default message when none is provided', () => {
    const html = renderNotFoundPage();
    expect(html).toContain('doesn');
  });

  it('uses a custom message when provided', () => {
    const html = renderNotFoundPage({ message: 'No dashboard with id "foo".' });
    // HTML-escaped on render.
    expect(html).toContain('No dashboard with id &quot;foo&quot;');
  });
});

describe('catch-all 404 route', () => {
  it('returns the styled 404 page for an unknown URL', async () => {
    const app = await makeApp();
    const res = await request(app).get('/this/route/does/not/exist')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(404);
    expect(res.text).toContain('404');
    expect(res.text).toContain('/this/route/does/not/exist');
    expect(res.text).toContain('href="/agents"');
  });

  it('GET /dashboards/:id with unknown id renders the 404 page (not raw HTML)', async () => {
    const app = await makeApp();
    const res = await request(app).get('/dashboards/nope')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', COOKIE);
    expect(res.status).toBe(404);
    expect(res.text).toContain('No dashboard with id &quot;nope&quot;');
    expect(res.text).toContain('topbar'); // styled, not bare <p>
  });
});
