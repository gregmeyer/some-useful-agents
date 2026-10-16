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
 * The agent catalog (GET /agents): shelves when browsing, sua's picks for a
 * question, slim cards. (Was: `/agents` search used to be a substring match over id/name/description, so
 * "watch a website for changes" returned nothing even though an agent existed
 * for exactly that. It now also scores the routing metadata, using the same
 * ranker inbox triage uses.
 *
 * The governing rule under test: relevance WIDENS and reorders, it never
 * removes. Anything the substring match found must still be found.
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

async function makeApp(agents: Agent[], finder?: (inputs: Record<string, string>) => Promise<string | undefined>) {
  dir = mkdtempSync(join(tmpdir(), 'sua-agents-catalog-'));
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
    ...(finder ? { agentFindRun: finder } : {}),
  } as unknown as DashboardContext;

  return buildDashboardApp(ctx);
}

const get = (app: ReturnType<typeof buildDashboardApp>, url: string) =>
  request(app).get(url).set(HDRS);

afterEach(async () => {
  if (provider) await provider.shutdown();
  try { runStore?.close(); } catch { /* ignore */ }
  try { agentStore?.close(); } catch { /* ignore */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});


const run = (id: string, agentName: string, startedAt: string, status = 'completed') =>
  runStore.createRun({ id, agentName, status, startedAt, triggeredBy: 'cli' } as never);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe('the agent catalog', () => {
  it('browsing: your go-to, used lately, on a schedule, every agent in a line, demos folded away', async () => {
    const app = await makeApp([
      mk({ id: 'job-finder', name: 'Job Finder', description: 'Finds jobs.', starred: true }),
      mk({ id: 'news-digest', name: 'News Digest', description: 'Morning news.' }),
      mk({ id: 'weather', name: 'Weather', description: 'The forecast.', schedule: '0 7 * * *' }),
      mk({ id: 'auto-retry-smoke', name: 'auto-retry-smoke', description: 'R2 + R3 test' }),
      mk({ id: 'half-built', name: 'half-built', status: 'draft', description: 'Not run.' }),
    ]);
    agentStore.updateAgentMeta('job-finder', { starred: true });
    for (let i = 0; i < 4; i++) run(`n${String(i)}`, 'news-digest', ago(i + 1));
    run('w1', 'weather', ago(20));
    run('s1', 'auto-retry-smoke', ago(1));
    const page = (await get(app, '/agents')).text;
    const shelf = (title: string) => page.slice(page.indexOf(`>${title} <span`), page.indexOf('</section>', page.indexOf(`>${title} <span`)));
    // Starred first, then the most-run; a test agent never makes a shelf.
    expect(shelf('Your go-to')).toContain('href="/agents/job-finder">Job Finder</a>');
    expect(shelf('Your go-to')).toContain('href="/agents/news-digest">News Digest</a>');
    expect(shelf('Your go-to')).not.toContain('auto-retry-smoke');
    expect(shelf('On a schedule')).toContain('/agents/weather');
    expect(page).toContain('used 1d ago · 4 runs this month');
    // Everything, one line each; the smoke test and the never-run draft are folded.
    const all = shelf('All agents');
    expect(all).toContain('class="ag-row"');
    expect(all).toContain('/agents/weather');
    expect(all).not.toContain('/agents/auto-retry-smoke');
    expect(page).toMatch(/<summary>Demos, tests and drafts never run \(2\)<\/summary>[\s\S]*auto-retry-smoke[\s\S]*half-built/);
    // No pager when browsing; filters are folded.
    expect(page).not.toContain('class="pager"');
    expect(page).toContain('<details class="ag-filters">');
  });

  it('a question shows the keyword matches and asks sua which agents do it', async () => {
    const asked: Array<Record<string, string>> = [];
    const app = await makeApp([
      mk({ id: 'job-finder', name: 'Job Finder', description: 'Finds open roles at companies.', sampleQuestions: ['Who is hiring controllers?'] }),
      mk({ id: 'news-digest', name: 'News Digest', description: 'Morning news.' }),
    ], async (inputs) => {
      asked.push(inputs);
      return `<matches>${JSON.stringify({ recommendation: 'Job Finder is the one. It looks at company job boards.', matches: [
        { agentId: 'job-finder', name: 'Job Finder', score: 0.9, why: 'Finds open roles at the companies you name.' },
        { agentId: 'news-digest', score: 0.2, why: 'Not really.' },
        { agentId: 'made-up', score: 0.8, why: 'Not installed.' },
      ] })}</matches>`;
    });
    const page = (await get(app, '/agents?q=find+jobs+at+fintech+startups')).text;
    expect(page).toContain('value="find jobs at fintech startups"');
    expect(page).toContain('>Keyword matches</h2>');
    const id = /data-agent-find="([^"]+)"/.exec(page)?.[1];
    expect(id).toBeTruthy();
    expect(asked[0]?.QUERY).toBe('find jobs at fintech startups');
    expect(JSON.parse(asked[0]!.AGENT_CATALOG!).map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining(['job-finder', 'news-digest']));
    await new Promise((r) => setTimeout(r, 20));
    const answer = (await get(app, `/agents/find/${id!}`)).body as { status: string; html: string };
    expect(answer.status).toBe('ready');
    expect(answer.html).toContain('Job Finder is the one. It looks at company job boards.');
    expect(answer.html).toContain('href="/agents/job-finder">Job Finder</a> <span class="ag-chip ag-chip--best">best fit</span>');
    expect(answer.html).toContain('Finds open roles at the companies you name.');
    expect(answer.html).toContain('data-ask="Who is hiring controllers?"');
    expect(answer.html).not.toContain('news-digest');   // scored too low
    expect(answer.html).not.toContain('made-up');       // not installed
    // Asked again within the hour: the same answer, not another search.
    const again = (await get(app, '/agents?q=Find+jobs+at+fintech+startups')).text;
    expect(again).toContain(`data-agent-find="${id!}"`);
    expect(asked).toHaveLength(1);
  });

  it('when nothing fits, sua offers to build one', async () => {
    const app = await makeApp([mk({ id: 'news-digest', name: 'News Digest', description: 'Morning news.' })],
      async () => '<matches>{"recommendation":"No installed agent covers this.","matches":[]}</matches>');
    const page = (await get(app, '/agents?q=book+a+table+for+dinner')).text;
    const id = /data-agent-find="([^"]+)"/.exec(page)![1]!;
    await new Promise((r) => setTimeout(r, 20));
    const html = ((await get(app, `/agents/find/${id}`)).body as { html: string }).html;
    expect(html).toContain('No installed agent covers this.');
    expect(html).toContain('data-ask="Build an agent that can: book a table for dinner"');
  });

  it('without the finder installed there is no panel, and the filter chips survive paging', async () => {
    const many = Array.from({ length: 14 }, (_, i) => mk({ id: `caller-${String(i).padStart(2, '0')}`, name: `Caller ${String(i)}`,
      nodes: [{ id: 'call', type: 'agent-invoke', agentInvoke: { agentId: 'callee' } } as never] }));
    const app = await makeApp([...many, mk({ id: 'callee', name: 'Callee' })]);
    const page = (await get(app, '/agents?q=caller')).text;
    expect(page).not.toContain('data-agent-find');
    const composed = (await get(app, '/agents?composed=1')).text;
    expect(composed).toContain('<details class="ag-filters" open>');
    expect(composed).toContain('href="/agents?tab=examples&amp;composed=1"');
  });
});
