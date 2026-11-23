/**
 * Smoke test for the "Used by" surface on `/tools/:id`. Doesn't poke the
 * exact HTML — that's brittle — just asserts each agent's id appears in
 * the rendered body when it references the tool, and is absent otherwise.
 */

import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { DashboardsStore, PacksStore, ToolStore } from '@some-useful-agents/core';
import { buildDashboardApp } from '../index.js';
import { SESSION_COOKIE } from '../auth-middleware.js';
import { createTestContext, closeTestContext, type TestContext } from '../test-harness.js';

const TOKEN = 'a'.repeat(64);
const PORT = 3996;
const COOKIE = `${SESSION_COOKIE}=${TOKEN}`;

let t: TestContext | undefined;

async function makeApp() {
  t = await createTestContext({ port: PORT, prefix: 'sua-tools-usedby-', extra: ({ dbPath }) => ({
    packsStore: new PacksStore(dbPath), dashboardsStore: new DashboardsStore(dbPath), toolStore: new ToolStore(dbPath),
  }) });
  const { ctx } = t;
  const { agentStore } = ctx;

  // Two agents that use http-get; one that doesn't.
  agentStore.createAgent({
    id: 'fetch-a', name: 'Fetch A', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'go', type: 'shell', tool: 'http-get', toolInputs: { url: 'https://example.com/a' }, dependsOn: [] }],
  }, 'cli');
  agentStore.createAgent({
    id: 'fetch-b', name: 'Fetch B', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'go', type: 'shell', tool: 'http-get', toolInputs: { url: 'https://example.com/b' }, dependsOn: [] }],
  }, 'cli');
  agentStore.createAgent({
    id: 'shell-only', name: 'Shell Only', status: 'active', source: 'local', mcp: false,
    nodes: [{ id: 'echo', type: 'shell', command: 'echo hi', dependsOn: [] }],
  }, 'cli');

  return buildDashboardApp(ctx);
}

afterEach(async () => {
  await closeTestContext(t);
  t = undefined;
});

describe('GET /tools/:id "Used by" section', () => {
  it('lists agents that reference http-get and excludes those that do not', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/http-get')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Used by');
    expect(res.text).toMatch(/href="\/agents\/fetch-a"/);
    expect(res.text).toMatch(/href="\/agents\/fetch-b"/);
    expect(res.text).not.toMatch(/href="\/agents\/shell-only"/);
  });

  it('lists shell-only agent under the shell-exec tool', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/shell-exec')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/href="\/agents\/shell-only"/);
  });

  it('renders an empty-state message when no agents reference the tool', async () => {
    const app = await makeApp();
    const res = await request(app).get('/tools/file-write')
      .set('Host', `127.0.0.1:${PORT}`).set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/No agents reference this tool yet/);
  });
});
