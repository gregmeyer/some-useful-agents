import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// detectLlms() shells out to the real machine, which would make every
// assertion here depend on whether the dev box happens to have `claude` on
// PATH. Pin it.
const mocked = vi.hoisted(() => ({
  availability: {
    claude: { installed: false } as { installed: boolean; version?: string },
    codex: { installed: false } as { installed: boolean; version?: string },
    'apple-foundation-models': { installed: false } as { installed: boolean; version?: string },
  },
}));

vi.mock('@some-useful-agents/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@some-useful-agents/core')>();
  return { ...actual, detectLlms: () => mocked.availability };
});

const {
  AgentStore, LlmSettingsStore, LocalProvider, MemorySecretsStore, RunStore,
  buildLoopbackAllowlist, loadAgents,
} = await import('@some-useful-agents/core');
const { buildDashboardApp } = await import('../index.js');
const { SESSION_COOKIE } = await import('../auth-middleware.js');
const { MemorySecretsSession } = await import('../secrets-session.js');
const { invalidateProviderReadiness } = await import('../lib/provider-readiness.js');
const { slugifyProviderName, MODEL_GATE_SKIP_COOKIE } = await import('./connect-model.js');
type DashboardContext = import('../context.js').DashboardContext;

const TOKEN = 'a'.repeat(64);
const PORT = 3991;
const HDRS = { Host: `127.0.0.1:${PORT}`, Cookie: `${SESSION_COOKIE}=${TOKEN}` };

let dir: string;
let provider: InstanceType<typeof LocalProvider>;
let runStore: InstanceType<typeof RunStore>;
let agentStore: InstanceType<typeof AgentStore>;
let llmSettingsStore: InstanceType<typeof LlmSettingsStore>;
let stubServer: Server | undefined;

/** A local endpoint that answers GET /models, so the probe can succeed. */
async function startStubEndpoint(): Promise<string> {
  stubServer = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => stubServer!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(stubServer.address() as AddressInfo).port}/v1`;
}

async function makeApp(opts: { withLlmStore?: boolean } = {}) {
  dir = mkdtempSync(join(tmpdir(), 'sua-connect-model-'));
  const dbPath = join(dir, 'runs.db');
  const agentsDir = join(dir, 'agents', 'local');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'hello.yaml'), 'name: hello\ntype: shell\ncommand: echo hi\n');

  const secretsStore = new MemorySecretsStore();
  runStore = new RunStore(dbPath);
  agentStore = new AgentStore(dbPath);
  provider = new LocalProvider(dbPath, secretsStore);
  await provider.initialize();
  llmSettingsStore = new LlmSettingsStore(join(dir, 'llm-settings.json'));

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
    llmSettingsStore: opts.withLlmStore === false ? undefined : llmSettingsStore,
    allowUntrustedShell: new Set<string>(),
    activeRuns: new Map(),
    inboxTriageAbortControllers: new Map(),
    inboxTriagePendingRefires: new Set(),
    dataDir: dir,
    dashboardBaseUrl: `http://127.0.0.1:${PORT}`,
  } as unknown as DashboardContext;

  return buildDashboardApp(ctx);
}

beforeEach(() => {
  mocked.availability = {
    claude: { installed: false },
    codex: { installed: false },
    'apple-foundation-models': { installed: false },
  };
  // The readiness snapshot is a module-level cache; a stale one would leak
  // the previous test's answer into this one.
  invalidateProviderReadiness();
});

afterEach(async () => {
  if (provider) await provider.shutdown();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  if (stubServer) {
    await new Promise<void>((resolve) => stubServer!.close(() => resolve()));
    stubServer = undefined;
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('slugifyProviderName', () => {
  it('passes through an already-legal slug', () => {
    expect(slugifyProviderName('gpt-4o-mini')).toBe('gpt-4o-mini');
  });

  it('rewrites the separators real model ids use, keeping legal ones', () => {
    // `_` and `.` are legal in the store's name regex, so they survive; `/`
    // and `:` do not, and collapse into single hyphens.
    expect(slugifyProviderName('unsloth/Qwen3-8B-GGUF:UD-Q4_K_XL')).toBe('unsloth-qwen3-8b-gguf-ud-q4_k_xl');
  });

  it('falls back rather than emitting an illegal empty name', () => {
    expect(slugifyProviderName('///')).toBe('my-model');
    expect(slugifyProviderName('')).toBe('my-model');
  });
});

describe('first-run model gate', () => {
  it('redirects GET / to /connect-model when nothing resolves', async () => {
    const app = await makeApp();
    const res = await request(app).get('/').set(HDRS);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/connect-model');
  });

  it('does not gate when a builtin CLI is installed', async () => {
    mocked.availability.claude = { installed: true, version: '1.0.0' };
    invalidateProviderReadiness();
    const app = await makeApp();
    const res = await request(app).get('/').set(HDRS);
    expect(res.status).toBe(200);
  });

  it('does not gate once a custom endpoint is configured', async () => {
    const app = await makeApp();
    llmSettingsStore.addCustomProvider({
      name: 'local', kind: 'openai', apiBase: 'http://127.0.0.1:11434/v1', model: 'llama3.2',
    });
    invalidateProviderReadiness();
    const res = await request(app).get('/').set(HDRS);
    expect(res.status).toBe(200);
  });

  it('honors the skip cookie', async () => {
    const app = await makeApp();
    const res = await request(app).get('/')
      .set('Host', `127.0.0.1:${PORT}`)
      .set('Cookie', `${SESSION_COOKIE}=${TOKEN}; ${MODEL_GATE_SKIP_COOKIE}=1`);
    expect(res.status).toBe(200);
  });

  it('POST /connect-model/skip sets the cookie and returns home', async () => {
    const app = await makeApp();
    const res = await request(app).post('/connect-model/skip').set(HDRS);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(String(res.headers['set-cookie'])).toContain(`${MODEL_GATE_SKIP_COOKIE}=1`);
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');
  });

  it('does not gate when the dashboard runs without an LLM settings store', async () => {
    // Read-only mode: the connect screen could not save anything, so gating
    // would strand the operator on a dead form.
    const app = await makeApp({ withLlmStore: false });
    const res = await request(app).get('/').set(HDRS);
    expect(res.status).toBe(200);
  });
});

describe('GET /connect-model', () => {
  it('offers both routes and reports undetected builtins', async () => {
    const app = await makeApp();
    const res = await request(app).get('/connect-model').set(HDRS);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Connect a model');
    expect(res.text).toContain('Paste an API key');
    expect(res.text).toContain('Run it yourself');
    expect(res.text).toContain('Skip for now');
    // Nothing detected, so no "Detected" badge should appear.
    expect(res.text).not.toContain('>Detected<');
  });

  it('flips to the informational variant once a model resolves', async () => {
    mocked.availability.claude = { installed: true, version: '1.2.3' };
    invalidateProviderReadiness();
    const app = await makeApp();
    const res = await request(app).get('/connect-model').set(HDRS);
    expect(res.status).toBe(200);
    expect(res.text).toContain('>Detected<');
    expect(res.text).toContain('Go to dashboard');
    expect(res.text).not.toContain('Skip for now');
  });
});

describe('POST /connect-model/connect', () => {
  it('saves a reachable endpoint and promotes it to primary', async () => {
    const apiBase = await startStubEndpoint();
    const app = await makeApp();
    const res = await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      .send({ mode: 'local', apiBase, model: 'llama3.2' });

    expect(res.status).toBe(302);
    // Lands on the starters, not the home feed — connecting a model and
    // having something to run with it are one flow.
    expect(res.headers.location).toContain('/start?ok=');

    const settings = llmSettingsStore.get();
    expect(settings.customProviders?.map((c) => c.name)).toEqual(['llama3.2']);
    // Promoted, not appended: the stock chain is ['claude'] even with no
    // claude binary, so appending would hide the new endpoint behind it.
    expect(settings.providers[0]).toBe('llama3.2');
    expect(settings.providers).toContain('claude');
  });

  it('slugifies the provider name from the model id', async () => {
    const apiBase = await startStubEndpoint();
    const app = await makeApp();
    await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      .send({ mode: 'local', apiBase, model: 'unsloth/Qwen3-8B:Q4' });

    expect(llmSettingsStore.get().providers[0]).toBe('unsloth-qwen3-8b-q4');
  });

  it('stores the pasted key on the provider', async () => {
    const apiBase = await startStubEndpoint();
    const app = await makeApp();
    await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      .send({ mode: 'hosted', apiBase, model: 'gpt-4o-mini', apiKey: 'sk-test-123' });

    expect(llmSettingsStore.get().customProviders?.[0].apiKey).toBe('sk-test-123');
  });

  it('refuses to save when the probe fails, and offers "Save anyway"', async () => {
    const app = await makeApp();
    const res = await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      // Port 1 is reserved and never listening — instant ECONNREFUSED.
      .send({ mode: 'local', apiBase: 'http://127.0.0.1:1/v1', model: 'nope' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('That endpoint');
    expect(res.text).toContain('Save anyway');
    expect(llmSettingsStore.get().customProviders ?? []).toEqual([]);
  });

  it('never replays the pasted key into the re-rendered form', async () => {
    const app = await makeApp();
    const res = await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      .send({ mode: 'hosted', apiBase: 'http://127.0.0.1:1/v1', model: 'gpt-4o-mini', apiKey: 'sk-super-secret' });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain('sk-super-secret');
  });

  it('force=1 saves without probing', async () => {
    const app = await makeApp();
    const res = await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      .send({ mode: 'local', apiBase: 'http://127.0.0.1:1/v1', model: 'offline-model', force: '1' });

    expect(res.status).toBe(302);
    expect(llmSettingsStore.get().providers[0]).toBe('offline-model');
  });

  it('rejects a submission missing the base URL or model', async () => {
    const app = await makeApp();
    const res = await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      .send({ mode: 'hosted', apiBase: '', model: '' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('are both required');
    expect(llmSettingsStore.get().customProviders ?? []).toEqual([]);
  });

  it('clears the readiness cache so the gate opens immediately', async () => {
    const apiBase = await startStubEndpoint();
    const app = await makeApp();
    // Prime the cache with "not ready".
    expect((await request(app).get('/').set(HDRS)).status).toBe(302);

    await request(app).post('/connect-model/connect').set(HDRS)
      .type('form')
      .send({ mode: 'local', apiBase, model: 'llama3.2' });

    expect((await request(app).get('/').set(HDRS)).status).toBe(200);
  });
});
