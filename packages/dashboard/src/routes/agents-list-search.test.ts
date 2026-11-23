import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { type Agent } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

/**
 * `/agents` search used to be a substring match over id/name/description, so
 * "watch a website for changes" returned nothing even though an agent existed
 * for exactly that. It now also scores the routing metadata, using the same
 * ranker inbox triage uses.
 *
 * The governing rule under test: relevance WIDENS and reorders, it never
 * removes. Anything the substring match found must still be found.
 */

const TOKEN = 'a'.repeat(64);
const PORT = 3993;
const HDRS = { Host: `127.0.0.1:${PORT}`, Cookie: `${SESSION_COOKIE}=${TOKEN}` };

let t: TestContext | undefined;

const mk = (over: Partial<Agent>): Agent => ({
  id: 'x', name: 'X', status: 'active', source: 'local', mcp: false,
  nodes: [{ id: 'main', type: 'shell', command: 'echo hi' }],
  ...over,
} as Agent);

async function makeApp(agents: Agent[]) {
  t = await createTestContext({ port: PORT, prefix: 'sua-agents-search-' });
  const { ctx, ctx: { agentStore } } = t;

  for (const a of agents) {
    const { version, ...rest } = a as Agent & { version?: number };
    agentStore.upsertAgent(rest as Agent, 'import', 'test fixture');
  }

  return buildDashboardApp(ctx);
}

const get = (app: ReturnType<typeof buildDashboardApp>, url: string) =>
  request(app).get(url).set(HDRS);

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

describe('GET /agents search ranking', () => {
  it('finds an agent whose ONLY match is its routing metadata', async () => {
    // The headline case. Nothing in id/name/description says "watch" or
    // "website" — only entryConditions does.
    const app = await makeApp([
      mk({
        id: 'page-sentry', name: 'Page Sentry', description: 'A utility.',
        entryConditions: ['user wants to watch a website for changes'],
      }),
      mk({ id: 'unrelated', name: 'Unrelated', description: 'Does other things.' }),
    ]);

    const res = await get(app, '/agents?q=watch+a+website+for+changes');
    expect(res.status).toBe(200);
    expect(res.text).toContain('page-sentry');
  });

  it('ranks the stronger match first', async () => {
    const app = await makeApp([
      mk({ id: 'weak-match', name: 'Weak', description: 'mentions weather once' }),
      mk({
        id: 'strong-match', name: 'Strong',
        tags: ['weather'], entryConditions: ['user asks about the weather'],
      }),
    ]);

    const res = await get(app, '/agents?q=weather');
    expect(res.text.indexOf('strong-match')).toBeLessThan(res.text.indexOf('weak-match'));
  });

  it('still finds everything the old substring match found', async () => {
    // The superset rule: a description-only hit has no routing metadata at all
    // and must survive.
    const app = await makeApp([
      mk({ id: 'legacy', name: 'Legacy', description: 'handles invoices' }),
    ]);
    expect((await get(app, '/agents?q=invoices')).text).toContain('legacy');
  });

  it('an explicit sort overrides relevance', async () => {
    // The card renders the agent ID as its title, so assert on ids.
    const weak = mk({ id: 'aaa-weak', name: 'Aaa', description: 'weather' });
    const strong = mk({ id: 'zzz-strong', name: 'Zzz', tags: ['weather'], entryConditions: ['weather please'] });
    const app = await makeApp([weak, strong]);

    // Relevance alone would put zzz-strong first...
    const ranked = await get(app, '/agents?q=weather');
    expect(ranked.text.indexOf('zzz-strong')).toBeLessThan(ranked.text.indexOf('aaa-weak'));

    // ...but a deliberate ?sort=name wins.
    const byName = await get(app, '/agents?q=weather&sort=name');
    expect(byName.text.indexOf('aaa-weak')).toBeLessThan(byName.text.indexOf('zzz-strong'));
  });

  it('falls back to name order for a query that tokenizes to nothing', async () => {
    // "pr" is under the 3-char floor, so there is nothing to rank by. It must
    // not silently claim to be sorting by best match.
    const app = await makeApp([mk({ id: 'pr-helper', name: 'PR Helper' })]);
    const res = await get(app, '/agents?q=pr');
    expect(res.status).toBe(200);
    expect(res.text).toContain('pr-helper');
    expect(res.text).not.toContain('Sort: best match');
  });

  it('labels the sort as best match while ranking', async () => {
    const app = await makeApp([mk({ id: 'weather-thing', name: 'Weather Thing' })]);
    expect((await get(app, '/agents?q=weather')).text).toContain('Sort: best match');
  });

  it('tab counts include metadata-only matches', async () => {
    const app = await makeApp([
      mk({
        id: 'ex-agent', name: 'Ex', source: 'examples',
        entryConditions: ['user wants to watch a website for changes'],
      }),
    ]);
    // Searching from the User tab should still report the Examples hit.
    const res = await get(app, '/agents?q=watch+a+website&tab=user');
    expect(res.text).toMatch(/Examples <span class="dim">\(1\)/);
  });

  it('echoes the query as typed, not lowercased', async () => {
    const app = await makeApp([mk({ id: 'weather-thing', name: 'Weather Thing' })]);
    const res = await get(app, '/agents?q=Weather+Forecast');
    expect(res.text).toContain('value="Weather Forecast"');
  });

  it('an empty search keeps the box and points elsewhere', async () => {
    const app = await makeApp([
      mk({ id: 'ex-only', name: 'Ex Only', source: 'examples', description: 'rainfall data' }),
    ]);
    const res = await get(app, '/agents?q=rainfall&tab=user');

    expect(res.text).toContain('No agents match');
    // The cross-tab hint — right search, wrong tab.
    expect(res.text).toContain('1 in Examples');
    // And crucially the search box survives, so the query is editable.
    expect(res.text).toContain('name="q"');
    // Not the "you have no agents yet" onboarding copy.
    expect(res.text).not.toContain('No agents yet');
  });

  it('no query renders the list unchanged', async () => {
    const app = await makeApp([mk({ id: 'one', name: 'One' }), mk({ id: 'two', name: 'Two' })]);
    const res = await get(app, '/agents');
    expect(res.status).toBe(200);
    expect(res.text).toContain('one');
    expect(res.text).toContain('two');
    expect(res.text).not.toContain('No agents match');
  });
});
