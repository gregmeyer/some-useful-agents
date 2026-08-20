import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentStore,
  LocalProvider,
  MemorySecretsStore,
  RunStore,
  buildLoopbackAllowlist,
  loadAgents,
  type Agent,
} from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import type { DashboardContext } from '../context.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { MemorySecretsSession } from '../secrets-session.js';

/**
 * "Ask this" chips — the surface that finally makes `sampleQuestions` visible.
 *
 * Those fields have been in the schema and read by every router for a while,
 * but rendered in ZERO views, so the audience deciding "is this the right
 * agent?" could never see them.
 *
 * A chip carries the question in `data-ask`; a delegated handler in
 * app-ask.js.ts drops it into the "sua ›" band. The behavior a route test CAN
 * cover is what this file asserts: that the attribute is emitted, carries the
 * FULL question even when the visible label is truncated, and is escaped so an
 * agent definition can't inject markup. The click behavior itself is verified
 * in a real browser (see the PR).
 */

const TOKEN = 'a'.repeat(64);
const PORT = 3994;
const HDRS = { Host: `127.0.0.1:${PORT}`, Cookie: `${SESSION_COOKIE}=${TOKEN}` };

let dir: string;
let provider: LocalProvider;
let runStore: RunStore;
let agentStore: AgentStore;

const mk = (over: Partial<Agent>): Agent => ({
  id: 'x', name: 'X', status: 'active', source: 'local', mcp: false,
  nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
  ...over,
} as Agent);

async function makeApp(agents: Agent[]) {
  dir = mkdtempSync(join(tmpdir(), 'sua-ask-chips-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();

  for (const a of agents) {
    const { version, ...rest } = a as Agent & { version?: number };
    agentStore.upsertAgent(rest as Agent, 'import', 'test fixture');
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
    allowUntrustedShell: new Set<string>(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as unknown as DashboardContext;

  return buildDashboardApp(ctx);
}

const get = (app: ReturnType<typeof buildDashboardApp>, url: string) =>
  request(app).get(url).set(HDRS);

/** Every `data-ask="…"` value on the page, HTML-unescaped. */
function askAttrs(htmlText: string): string[] {
  return [...htmlText.matchAll(/data-ask="([^"]*)"/g)].map((m) =>
    m[1]
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'),
  );
}

afterEach(async () => {
  if (provider) await provider.shutdown();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('ask chips on the agent detail page', () => {
  it('renders every sample question as a chip', async () => {
    const questions = [
      'Will it rain in Denver tomorrow?',
      'Do I need a jacket this weekend?',
      'How warm is it outside right now?',
    ];
    const app = await makeApp([mk({ id: 'sky', name: 'Sky', sampleQuestions: questions })]);
    const res = await get(app, '/agents/sky');
    expect(res.status).toBe(200);
    for (const q of questions) expect(askAttrs(res.text)).toContain(q);
  });

  it('shows entryConditions and nonEntryConditions as Use when / Not for', async () => {
    const app = await makeApp([mk({
      id: 'sky', name: 'Sky',
      entryConditions: ['user asks whether it will rain'],
      nonEntryConditions: ['user asks about historical climate averages'],
    })]);
    const res = await get(app, '/agents/sky');
    expect(res.text).toContain('Use when');
    expect(res.text).toContain('user asks whether it will rain');
    expect(res.text).toContain('Not for');
    expect(res.text).toContain('user asks about historical climate averages');
  });

  it('omits the panel entirely when an agent declares no routing metadata', async () => {
    // Most user-authored agents have none. An empty "What you can ask" box on
    // every one of them would be noise.
    const app = await makeApp([mk({ id: 'bare', name: 'Bare' })]);
    const res = await get(app, '/agents/bare');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('What you can ask');
    expect(res.text).not.toContain('ask-panel');
  });

  it('escapes quotes and markup so an agent cannot inject into the attribute', async () => {
    // sampleQuestions are author-controlled and land in an HTML attribute.
    const nasty = 'What about "quotes" & <script>alert(1)</script>?';
    const app = await makeApp([mk({ id: 'evil', name: 'Evil', sampleQuestions: [nasty] })]);
    const res = await get(app, '/agents/evil');
    expect(res.status).toBe(200);
    // The raw tag must never appear...
    expect(res.text).not.toContain('<script>alert(1)</script>');
    // ...but the chip still carries the exact text for the ask band.
    expect(askAttrs(res.text)).toContain(nasty);
  });
});

describe('ask chips on the agents list', () => {
  it('puts ONE chip on a card, carrying the full question despite truncation', async () => {
    const long = 'Compile a thoroughly sourced research digest covering everything published this week';
    const app = await makeApp([mk({
      id: 'digest', name: 'Digest',
      sampleQuestions: [long, 'A second question that should not appear on the card.'],
    })]);
    const res = await get(app, '/agents');
    expect(res.status).toBe(200);

    const attrs = askAttrs(res.text);
    // Full text preserved for the band even though the label is shortened.
    expect(attrs).toContain(long);
    // The card shows one chip, not the whole set.
    expect(attrs).not.toContain('A second question that should not appear on the card.');
    // And the visible label really is truncated.
    expect(res.text).toContain('…');
  });

  it('renders no chip for an agent without sample questions', async () => {
    const app = await makeApp([mk({ id: 'bare', name: 'Bare' })]);
    const res = await get(app, '/agents');
    expect(res.status).toBe(200);
    expect(askAttrs(res.text)).toEqual([]);
  });

  it('offers the operator their own query as a chip when a search finds nothing', async () => {
    // The highest-leverage chip: they searched, got nothing, and the ranker
    // that would have found it is one click away.
    const app = await makeApp([mk({ id: 'unrelated', name: 'Unrelated' })]);
    const res = await get(app, '/agents?q=summarise+my+quarterly+revenue');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ask sua:');
    expect(askAttrs(res.text)).toContain('summarise my quarterly revenue');
  });
});
