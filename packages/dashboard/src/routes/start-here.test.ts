import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentStore,
  DashboardsStore,
  LocalProvider,
  MemorySecretsStore,
  PacksStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
  loadBuiltinPacks,
  installPack,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3992;
const HDRS = { Host: `127.0.0.1:${PORT}`, Cookie: `${SESSION_COOKIE}=${TOKEN}` };

// The real shipped packs — this suite deliberately exercises what users get.
const PACKS_DIR = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'core', 'packs',
);

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;
let packsStore: PacksStore;
let dashboardsStore: DashboardsStore;

async function makeApp(opts: { installStarters?: boolean; withPacks?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'sua-start-here-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'hello.yaml'), 'name: hello\ntype: shell\ncommand: echo hi\n');

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  packsStore = new PacksStore(dbPath);
  dashboardsStore = new DashboardsStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  if (opts.withPacks !== false) loadBuiltinPacks(packsStore, PACKS_DIR);
  if (opts.installStarters) {
    installPack('playground-starters', { packsStore, dashboardsStore, agentStore });
  }

  const ctx = {
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
    packsStore: opts.withPacks === false ? undefined : packsStore,
    dashboardsStore,
    allowUntrustedShell: new Set<string>(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as unknown as DashboardContext;

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  if (provider) await provider.shutdown();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  try { packsStore?.close(); } catch { /* ignore */ }
  try { dashboardsStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('GET /start', () => {
  it('renders the three curated starters with their patterns and tools', async () => {
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/start').set(HDRS);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Three agents, three patterns');

    for (const id of ['starter-research', 'starter-watch', 'starter-draft']) {
      expect(res.text, `${id} missing`).toContain(`/agents/${id}`);
    }
    // The pattern labels are the lesson, not the agent names.
    expect(res.text).toContain('Ask');
    expect(res.text).toContain('Watch');
    expect(res.text).toContain('Produce');
    // Tools are surfaced before you run anything.
    expect(res.text).toContain('web-fetch');
  });

  it('orders the cards the way the pack declares them', async () => {
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/start').set(HDRS);
    const pos = (id: string) => res.text.indexOf(`/agents/${id}`);
    expect(pos('starter-research')).toBeLessThan(pos('starter-watch'));
    expect(pos('starter-watch')).toBeLessThan(pos('starter-draft'));
  });

  it('marks the scheduled starter as scheduled', async () => {
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/start').set(HDRS);
    expect(res.text).toContain('on a schedule');
  });

  it('carries a page heading and tab strip like its sibling section pages', async () => {
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/start').set(HDRS);
    // /agents, /packs et al render pageHeader() then sectionTabs(); without
    // the header this page reads as structurally different from its siblings.
    expect(res.text).toContain('Quick start');
    expect(res.text).toContain('class="page-header"');
    expect(res.text).toContain('tab-strip');
    // Exactly one h1 — pageHeader owns it.
    expect((res.text.match(/<h1/g) ?? []).length).toBe(1);
  });

  it('draws the DAG shape on the card, before you run or open anything', async () => {
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/start').set(HDRS);
    // The silhouette itself...
    expect(res.text).toContain('class="mini-dag"');
    // ...its plain-English summary...
    expect(res.text).toContain('4 steps · 2 in parallel');
    expect(res.text).toContain('3 steps · 1 conditional');
    // ...and per-node hover text, so the dots aren't just decoration.
    expect(res.text).toContain('tools: web-fetch');
    expect(res.text).toContain('runs only if judge.verdict = YES');
  });

  it('links out to the full examples list', async () => {
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/start').set(HDRS);
    expect(res.text).toContain('/agents?tab=examples');
  });

  it('degrades to guidance when the starters are not installed', async () => {
    // Pack registered, agents never imported — the two are separate paths.
    const app = await makeApp({ installStarters: false });
    const res = await request(app).get('/start').set(HDRS);
    expect(res.status).toBe(200);
    expect(res.text).toContain('sua examples install');
  });

  it('does not 500 when the packs store is unavailable', async () => {
    const app = await makeApp({ withPacks: false });
    const res = await request(app).get('/start').set(HDRS);
    expect(res.status).toBe(200);
  });

  it('is linked from the Help page', async () => {
    // /start is useless if nobody can find it. Help is where someone goes
    // when they don't know where to start.
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/help').set(HDRS);
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/start"');
    expect(res.text).toContain('Quick start');
  });

  it('shows the flash handed over by the connect-a-model redirect', async () => {
    const app = await makeApp({ installStarters: true });
    const res = await request(app).get('/start?ok=Connected%20%22gpt-4o-mini%22').set(HDRS);
    expect(res.text).toContain('Connected');
    expect(res.text).toContain('gpt-4o-mini');
  });
});
