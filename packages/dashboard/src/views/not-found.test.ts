import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { DashboardsStore, LocalProvider, PacksStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';
import { renderNotFoundPage } from './not-found.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3995;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let t: TestContext | undefined;
let provider: LocalProvider | undefined;

async function makeApp() {
  t = await createTestContext({ port: PORT, prefix: 'sua-not-found-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath),
    dashboardsStore: new DashboardsStore(dbPath),
  }) });
  const { ctx } = t;
  provider = t.provider;

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  if (provider) {
    const start = Date.now();
    while ((provider as unknown as { running?: { size: number } }).running?.size && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  await closeTestContext(t);
  t = undefined;
  provider = undefined;
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
