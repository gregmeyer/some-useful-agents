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

type Fake = (inputs: Record<string, string>) => Promise<string | undefined>;
let lastCtx: DashboardContext;

async function makeApp(agents: Agent[], finder?: Fake, sorter?: Fake) {
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
    ...(sorter ? { agentCatalogSortRun: sorter } : {}),
  } as unknown as DashboardContext;
  lastCtx = ctx;

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
    // Talk it through with sua: a conversation that starts with the question and the picks.
    expect(answer.html).toContain('<form method="POST" action="/inbox/new" class="ag-talk">');
    expect(answer.html).toContain('value="I asked the agent catalog: “find jobs at fintech startups”. It suggested:\n- job-finder: Finds open roles at the companies you name.\nHelp me choose, or tell me if I should build a new agent for this."');
    expect(answer.html).toContain('name="page" value="/agents"');
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
    expect(html).toContain('value="I asked the agent catalog: “book a table for dinner”. Nothing fit (No installed agent covers this.). Should we build an agent for this?"');
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

describe('the agent catalog, by what they do', () => {
  const agents = [
    mk({ id: 'ashby-jobs', name: 'Ashby Jobs', description: 'Reads an Ashby board.' }),
    mk({ id: 'lever-jobs', name: 'Lever Jobs', description: 'Reads a Lever board.' }),
    mk({ id: 'news-digest', name: 'News Digest', description: 'Morning news.' }),
    mk({ id: 'odd-one', name: 'Odd One', description: 'Plays a sound.' }),
    mk({ id: 'quiet-check', name: 'Quiet Check', description: 'Pings a box.' }),
  ];
  const answer = (items: unknown[]) => `<groups>${JSON.stringify({ items })}</groups>`;
  const waitSorted = async () => { for (let i = 0; i < 50 && lastCtx.agentCatalogSorting; i++) await new Promise((r) => setTimeout(r, 10)); };

  it('sua sorts the agents into groups once; each group is a shelf, with a use-it-for line', async () => {
    const asked: Array<Record<string, string>> = [];
    const app = await makeApp(agents, undefined, async (inputs) => {
      asked.push(inputs);
      return answer([
        { id: 'ashby-jobs', group: 'Jobs & companies', useFor: 'Find open roles at a company on Ashby.' },
        { id: 'lever-jobs', group: 'Jobs & companies', useFor: 'Find open roles on Lever' },
        { id: 'news-digest', group: 'News & digests', useFor: 'Get a morning news digest' },
        { id: 'quiet-check', group: 'Demos & tests', useFor: 'Check a box answers' },
        { id: 'not-asked', group: 'Fun' },
      ]);
    });
    const first = (await get(app, '/agents')).text;
    expect(first).toContain('data-catalog-sorting');
    await waitSorted();
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0].AGENTS).map((a: { id: string }) => a.id).sort()).toEqual(['ashby-jobs', 'lever-jobs', 'news-digest', 'odd-one', 'quiet-check']);
    expect((await get(app, '/agents/catalog/sorting')).body).toEqual({ sorting: false });

    const page = (await get(app, '/agents')).text;
    expect(page).toContain('By what they do');
    const shelf = page.slice(page.indexOf('>Jobs &amp; companies <span'), page.indexOf('</section>', page.indexOf('>Jobs &amp; companies <span')));
    expect(shelf).toContain('/agents/ashby-jobs');
    expect(shelf).toContain('Find open roles at a company on Ashby</p>');
    // An agent sua didn't place waits under "Not sorted yet"; demos stay folded.
    expect(page.slice(page.indexOf('>Not sorted yet'))).toContain('/agents/odd-one');
    expect(page).not.toContain('>Demos &amp; tests <span');
    expect(page.slice(page.indexOf('ag-folded'))).toContain('/agents/quiet-check');

    // Nothing changed, so a reload doesn't sort again (odd-one failed: it waits).
    await get(app, '/agents');
    await waitSorted();
    expect(asked).toHaveLength(1);
  });

  it('a changed agent is sorted again', async () => {
    const asked: string[][] = [];
    const app = await makeApp(agents.slice(0, 1), undefined, async (inputs) => {
      const ids = (JSON.parse(inputs.AGENTS) as Array<{ id: string }>).map((a) => a.id);
      asked.push(ids);
      return answer(ids.map((id) => ({ id, group: 'Jobs & companies' })));
    });
    await get(app, '/agents'); await waitSorted();
    agentStore.upsertAgent({ ...agents[0], description: 'Reads any Ashby board, now with salaries.' } as Agent, 'dashboard', 'edit');
    await get(app, '/agents'); await waitSorted();
    expect(asked).toEqual([['ashby-jobs'], ['ashby-jobs']]);
  });

  it('?group= lists one group; the box finds agents by their use-it-for line', async () => {
    const app = await makeApp(agents, undefined, async () => answer([
      { id: 'ashby-jobs', group: 'Jobs & companies', useFor: 'Find open roles at a company' },
      { id: 'lever-jobs', group: 'Jobs & companies', useFor: 'Find open roles on Lever' },
      { id: 'news-digest', group: 'News & digests', useFor: 'Get headlines every morning' },
    ]));
    await get(app, '/agents'); await waitSorted();
    const group = (await get(app, '/agents?group=' + encodeURIComponent('Jobs & companies'))).text;
    expect(group).toContain('← All agents');
    expect(group).toContain('/agents/ashby-jobs');
    expect(group).toContain('/agents/lever-jobs');
    expect(group).not.toContain('/agents/news-digest"');
    // "headlines" is only in sua's line for news-digest, not in the agent itself.
    const search = (await get(app, '/agents?q=headlines')).text;
    expect(search).toContain('/agents/news-digest');
  });

  it('without the sorter installed, the page just shows the shelves', async () => {
    const app = await makeApp(agents);
    const page = (await get(app, '/agents')).text;
    expect(page).not.toContain('data-catalog-sorting');
    expect(page).not.toContain('By what they do');
  });
});
